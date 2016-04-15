"use strict";

module.exports = function(app, util, schemas, publicDir, profpicDir) {

	let extToMime = require("./extToMime.json"); // used to convert file extensions to mime types
	let lwip = require("lwip"); // image processing module
	let multer = require("multer"); // for file uploads
	let ObjectId = require("mongoose").Types.ObjectId;

	let Promise = require("bluebird");

	let requireLogin = util.requireLogin;
	let requireAdmin = util.requireAdmin;

	let User = schemas.User;

	// load profile page of any user based on _id
	app.get("/u/:id", function(req, res) {
		User.findOne({
			_id: req.params.id,
			teams: {
				$elemMatch: {
					"id": req.user.current_team.id
				}
			} // said user has to be a member of the current team of whoever is loading the page
		}).exec().then(function(user) {
			if (user) {
				// load user.ejs page with said user"s profile info
				res.render("user", {
					firstname: user.firstname,
					lastname: user.lastname,
					_id: user._id,
					email: user.email,
					phone: user.phone,
					profpicpath: user.profpicpath,
					viewedUserPosition: util.findTeamInUser(user, req.user.current_team.id).position,
					viewerUserPosition: req.user.current_team.position,
					viewerUserId: req.user._id
				});
			} else {
				util.userNotFound(res);
			}
		}).catch(function(err) {
			console.error(err);
			send404(res);
		});
	});

	// load default profile picture
	app.get("/images/user.jpg-60", function(req, res) {
		res.sendFile(publicDir + "/images/user.jpg");
	});

	app.get("/images/user.jpg-300", function(req, res) {
		res.sendFile(publicDir + "/images/user.jpg");
	});

	// load user profile picture from AWS S3
	app.get("/pp/:path", function(req, res) {
		res.redirect(profpicDir + req.params.path);
	});

	app.post("/f/login", function(req, res) {
		// IMPORTANT: req.body.username can either be a username or an email

		// because you can"t send booleans via HTTP
		if (req.body.rememberMe == "true") {
			req.body.rememberMe = true;
		} else {
			req.body.rememberMe = false;
		}

		User.findOne({
			$or: [{username: req.body.username}, {email: req.body.username}]
		}).exec().then(function(user) {
			if (user) {
				return user.comparePassword(req.body.password).then(function(isMatch) {
					if (isMatch) {
						// store user info in cookies
						req.session.user = user;
						if (req.body.rememberMe) {
							req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000; // change cookie expiration date to one year
						}
						res.json(user);
					} else {
						res.end("inc/password"); // incorrect password
					}
				});
			} else {
				res.end("inc/username") // incorrect username
			}
		}).catch(function(err) {
			console.error(err);
			res.end("fail");
		});
	});
	app.post("/f/logout", requireLogin, function(req, res) {
		// destroy user session cookie
		req.session.destroy(function(err) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				res.end("success");
			}
		})
	});

	// uses multer middleware to parse uploaded file called "profpic" with a max file size
	app.post("/f/createUser", multer({limits: {fileSize:10*1024*1024}}).single("profpic"), function(req, res) {
		//capitalize names
		req.body.firstname = req.body.firstname.capitalize();
		req.body.lastname = req.body.lastname.capitalize();

		// remove parentheses and dashes from phone number
		req.body.phone = req.body.phone.replace(/[- )(]/g,"")

		// if phone and email are valid (see util.js for validation methods)
		if ( util.validateEmail(req.body.email) && util.validatePhone(req.body.phone) ) {

			// check if a user with either same username, email, or phone already exists
			User.findOne({
				$or: [{
					username: req.body.username
				}, {
					email: req.body.email
				}, {
					phone: req.body.phone
				}]
			}).exec().then(function(user) {
				if (user) { // user exists
					res.end("exists");
				} else {
					if (req.body.password == req.body.password_confirm) {
						return Promise.resolve();
					} else {
						res.end("password mismatch");
					}
				}
				return Promise.break;
			}).then(function() {

				let userInfo = {
					username: req.body.username,
					password: req.body.password,
					firstname: req.body.firstname,
					lastname: req.body.lastname,
					email: req.body.email,
					phone: req.body.phone
				};

				// if user uploaded a profile pic
				if (req.file) {

					userInfo.profpicpath = "/pp/" + req.body.username;

					let ext = req.file.originalname.substring(req.file.originalname.lastIndexOf(".") + 1).toLowerCase() || "unknown";
					let mime = extToMime[ext]
					if (mime == undefined) {
						mime = "application/octet-stream";
					}

					return Promise.all([
						util.resizeImageAsync(req.file.buffer, 60, ext).then(function(buffer) { // resize image to 60px and upload to AWS S3
							return util.uploadToProfPicsAsync(buffer, req.body.username + "-60", mime);
						}),
						util.resizeImage(req.file.buffer, 300, ext).then(function(buffer) { // resize image to 300px and upload to AWS S3
							return util.uploadToProfPicsAsync(buffer, req.body.username + "-300", mime);
						})
					]).then(function() {
						return Promise.resolve(userInfo);
					});

				} else {
					userInfo.profpicpath = "/images/user.jpg"; // default profile picture
					return Promise.resolve(userInfo);
				}
			}).then(function(userInfo) {
				return User.create(userInfo);
			}).then(function() {
				res.end("success");
			}).catch(function(err) {
				console.error(err);
				res.end("fail");
			});
		} else {
			res.end("fail: Form data is invalid");
		}
	});
	app.post("/f/getUser", requireLogin, function(req, res) {
		User.findOne({_id: req.body._id}, "-password", function(err, user) {
			if (err) {
				console.error(err);
				res.end("fail");
			}
			res.json(user);
		})
	})
	app.post("/f/getUserTeams", requireLogin, function(req, res) {
		User.findOne({_id: req.body._id}, "-password", function(err, user) {
			if (err) {
				console.error(err);
				res.end("fail");
			}
			res.json({"teams": user.teams, "current_team": user.current_team});
		})
	})
	app.post("/f/changePosition", requireLogin, function(req, res) {

		//position hierarchy
		let positionHA = {
			"member": 0,
			"leader": 1,
			"admin": 2
		}
		let current_position;

		//find target user
		User.findOne({_id: req.body.user_id}, function(err, user) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				if (user) {
					//find position of current user
					current_position = util.findTeamInUser(user, req.user.current_team.id).position;
					//check position hierarchy to see if it is allowed for user to change the position of target user
					let updatePosition = function() {
				if ( positionHA[req.user.current_team.position] >= positionHA[req.body.target_position]
					&& positionHA[req.user.current_team.position] >= positionHA[current_position] ) {
							//update position of target user
							User.update({_id: req.body.user_id, "teams.id": req.user.current_team.id}, {"$set": {
								"teams.$.position": req.body.target_position, //find out what .$. means and if it means selected "teams" element
								"current_team.position": req.body.target_position //make sure in the future current_team.position is checked with "teams" array of the document when user is logging in as opposed to doing this
							}}, function(err) {
								if (err) {
									console.error(err);
									res.end("fail");
								} else {
									res.end("success");
								}
							});
						} else {
							res.end("fail");
						}
			};
			if (current_position == "admin") {
				User.count({
					teams: {
						id: req.user.current_team.id,
						position: "admin"
					}
				}, function(err, count) {
					if (err) {
						res.end("fail");
					} else if (count > 1) {
					 updatePosition();
				 } else {
						res.end("You are the only Admin on your team, so you cannot demote yourself.");
					}
				});
			} else {
				updatePosition();
			}
				} else {
					res.end("fail");
				}
			}
		})
	});

	app.post("/f/searchForUsers", requireLogin, function(req, res) {
		//create array of search terms
		let terms = req.body.search.split(" ");
		let regexString = "";
		//create regular expression
		for (let i = 0; i < terms.length; i++) {
			regexString += terms[i];
			if (i < terms.length - 1) regexString += "|";
		}
		let re = new RegExp(regexString, "ig");

		//find maximum of 10 users that match the search criteria
		User.find({
			teams: {$elemMatch: {id: req.user.current_team.id}},
			$or: [
				{ firstname: re }, { lastname: re }
			]
		}, "-password").limit(10).exec(function(err, users) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				res.json(users);
			}
		});
	})
	app.post("/f/changePassword", requireLogin, function(req, res) {
		if (req.body.new_password == req.body.new_password_confirm) {
			User.findOne({_id: req.user._id}, function(err, user) {
				//check if old password is correct
				user.comparePassword(req.body.old_password, function(err, isMatch) {
					if (err) {
						console.error(err);
						res.end("fail");
					} else {
						if (isMatch) {
							//set and save new password (password is automatically encrypted. see /schemas/User.js)
							user.password = req.body.new_password;
							user.save(function(err) {
								if (err) {
									console.error(err);
									res.end("fail");
								} else {
									res.end("success");
								}
							})
						} else {
							res.end("fail: incorrect password");
						}
					}
				})
			})
		} else {
			res.end("fail: new passwords do not match");
		}
	});
	app.post("/f/editProfile", requireLogin, multer().single("new_prof_pic"), function(req, res) {

		let updatedUser = {
			firstname: req.body.firstname,
			lastname: req.body.lastname,
			email: req.body.email,
			phone: req.body.phone,
		}

		if (req.body.parentEmail != "") {
			updatedUser.parentEmail = req.body.parentEmail
		}

		if (util.validateEmail(req.body.email) && util.validatePhone(req.body.phone)) {
			if (req.file) { //if user chose to update their profile picture too

				updatedUser.profpicpath = "/pp/" +  req.user.username

				//get extension and corresponding mime type
				let ext = req.file.originalname.substring(req.file.originalname.lastIndexOf(".")+1).toLowerCase() || "unknown";
				let mime = extToMime[ext]
				if (mime == undefined) {
					mime = "application/octet-stream"
				}

				//NOTE: for explanations of the functions used here, see util.js

				//resize image to 300px
				util.resizeImage(req.file.buffer, 300, ext, function(err, buffer) {
					if (err) {
						console.error(err);
						res.end("fail");
					} else {
						//upload to profile picture bucket in AWS
						util.uploadToProfPics(buffer, req.user.username+"-300", mime, function(err, data) {
							if (err) {
								console.error(err);
								res.end("fail");
							} else {
								//resize image to 60px
								util.resizeImage(req.file.buffer, 60, ext, function(err, buffer) {
									if (err) {
										console.error(err);
										res.end("fail");
									} else {
										//upload to profile picture bucket in AWS
										util.uploadToProfPics(buffer, req.user.username+"-60", mime, function(err, data) {
											if (err) {
												console.error(err);
												res.end("fail");
											} else {
												//update rest of user info in database
												User.findOneAndUpdate({_id: req.user._id}, updatedUser, function(err, user) {
													if (err) {
														console.error(err);
														res.end("fail");
													} else {
														res.end("success");
													}
												})
											}
										})
									}
								})
							}
						});
					}
				});
			} else {
				//update user info in database
				User.findOneAndUpdate({_id: req.user._id}, updatedUser, function(err, user) {
					if (err) {
						console.error(err);
						res.end("fail");
					} else {
						res.end("success");
					}
				});
			}
		} else {
			res.end("fail");
		}
	});
	//get information about the currently logged in user
	app.post("/f/getSelf", requireLogin, function(req, res) {
		User.findOne({_id: req.user._id}, "-password", function(err, user) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				res.end(JSON.stringify(user));
			}
		});
	});
	app.post("/f/removeUserFromTeam", requireLogin, requireAdmin, function(req, res) {
		let remove = function() {
	User.update({_id: req.body.user_id}, { "$pull": {
			"teams": {id: req.user.current_team.id},
			"subdivisions": {team: req.user.current_team.id}
		},
		/*"$push": {
			"bannedFromTeams": req.user.current_team.id //bans user from rejoining
		},*/

		}, function(err, model) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				User.findOne({_id: req.body.user_id}, function(err, user) {
					if (err) {
						console.error(err);
						res.end("fail");
					} else {
						//if user is currently using the team he is being banned from
						if (user.current_team.id == req.user.current_team.id) {
							user.current_team = undefined //TODO: make it so that if current_team is undefined when logging in, it allows you to set current_team
							user.save(function(err) {
								if (err) {
									console.error(err);
									res.end("fail");
								} else {
									Chat.update({
										team: req.user.current_team.id,
										userMembers: new ObjectId(req.body.user_id)
									}, {
										"$pull": {
											"userMembers": req.body.user_id
										}
									}, function(err, model) {
										if (err) {
											console.error(err);
											res.end("fail");
										} else {
											Folder.update({
												team: req.user.current_team.id,
												userMembers: new ObjectId(req.body.user_id)
											}, {
												"$pull": {
													"userMembers": req.body.user_id
												}
											}, function(err, model) {
												if (err) {
													console.error(err);
													res.end("fail");
												} else {
													Event.update({
														team: req.user.current_team.id,
														userAttendees: new ObjectId(req.body.user_id)
													}, {
														"$pull": {
															"userAttendees": req.body.user_id
														}
													}, function(err, model) {
														if (err) {
															console.error(err);
															res.end("fail");
														} else {
															res.end("success");
														}
													})
												}
											})
										}
									})
								}
							})
						}
					}
				});
			}
		});
	};
	User.findOne({
		_id: req.body.user_id
	}, function(err, user) {
		if (user.current_team.position == "admin") {
			User.count({
				teams: {
					id: req.user.current_team.id,
					position: "admin"
				}
			}, function(err, count) {
				if (err) {
					res.end("fail");
				} else if (count > 1) {
					 remove();
				 } else {
					res.end("You cannot remove the only Admin on your team.");
				}
			});
		} else {
			remove();
		}
	});
	});
	app.post("/f/forgotPassword", function(req, res) {
		User.findOne({email: req.body.email, username: req.body.username}, function(err, user) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				if (user) {
					//for function explanation see /schemas/User.js
					user.assignNewPassword(function(err, new_password) {
						if (err) {
							console.error(err);
							res.end("fail");
						} else {
							user.save(function(err) {
								if (err) {
									console.error(err);
									res.end("fail");
								} else {
									//email user new password
									util.notify.sendMail({
											from: "MorTeam Notification <notify@morteam.com>",
											to: req.body.email,
											subject: "New MorTeam Password Request",
											text: "It seems like you requested to reset your password. Your new password is " + new_password + ". Feel free to reset it after you log in."
									}, function(err, info) {
										if (err) {
											console.error(err);
											res.end("fail");
										} else {
											console.log(info);
											res.end("success");
										}
									});
								}
							})
						}
					});
				} else {
					res.end("does not exist");
				}
			}
		})
	});
};
