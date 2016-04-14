"use strict";

module.exports = function(app, util, schemas) {

	let requireLogin = util.requireLogin;
	let requireLeader = util.requireLeader;
	let requireAdmin = util.requireAdmin;

	let User = schemas.User;
	let Team = schemas.Team;

	//assign variables to util functions(and objects) and database schemas
	for (key in util) {
		eval("var " + key + " = util." + key + ";");
	}
	for (key in schemas) {
		eval("var " + key + " = schemas." + key + ";");
	}

	app.get("/team", requireLogin, function(req, res) {
		User.find({ teams: { $elemMatch: { id: req.user.current_team.id } } }, "-password", function(err, users) {
			Team.findOne({id: req.user.current_team.id}, function(err, team) {
				res.render("team", {
					teamName: team.name,
					teamNum: team.number,
					teamId: team.id,
					members: users,
					viewerIsAdmin: req.user.current_team.position=="admin",
				});
			});
		});
	});
	app.post("/f/getUsersInTeam", requireLogin, function(req, res) {
		User.find({
			teams: {$elemMatch: {id: req.user.current_team.id }}
		}, "-password", function(err, users) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				res.end(JSON.stringify(users));
			}
		})
	});
	app.post("/f/createTeam", requireLogin, function(req, res) {
		Team.find({id: req.body.id}, function(err, teams) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				if (teams.length == 0) {
					Team.create({
						id: req.body.id,
						name: req.body.name,
						number: req.body.number
					}, function(err, team) {
						if (err) {
							console.error(err);
							res.end("fail");
						} else {
							Folder.create({
								name: "Team Files",
								team: team.id,
								entireTeam: true,
								creator: req.user._id,
								defaultFolder: true
							}, function(err, folder) {
								if (err) {
									console.error(err);
									res.end("fail");
								} else {
									res.end("success");
								}
							});
						}
					});
				} else {
					res.end("fail");
				}
			}
		});
	});
	app.post("/f/joinTeam", requireLogin, function(req, res) {
		Team.findOne({
			id: req.body.team_id
		}, function(err, team) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				if (team) {
					User.findOne({
						_id: req.user._id
					}, function(err, user) {
						if (err) {
							console.error(err);
							res.end("fail")
						} else {
							if (user) {
								if ( user.bannedFromTeams.length > 0 && user.bannedFromTeams.indexOf(req.body.team_id) > -1 ) {
									res.end("banned");
								} else if (user.teams.length > 0) {
									User.find({teams: {$elemMatch: {"id": req.body.team_id} } }, function(err, users) {
										if (err) {
											console.error(err);
											res.end("fail");
										} else {
											if (users.length > 0) {
												user.teams.push({id: req.body.team_id, position: "member"});
											} else {
												user.teams.push({id: req.body.team_id, position: "admin"});
											}
											AttendanceHandler.update({ entireTeam: true, event_date: { $gte: new Date() } }, {
												"$push": {
													"attendees": {user: req.user._id, status: "absent"}
												}
											}, function(err, model) {
												if (err) {
													console.error(err);
													res.end("fail");
												} else {
													user.save(function(err) {
														if (err) {
															console.error(err);
															res.end("fail");
														} else {
															Folder.create({
																name: "Personal Files",
																team: req.body.team_id,
																userMembers: req.user._id,
																creator: req.user._id,
																defaultFolder: true
															}, function(err, folder) {
																if (err) {
																	console.error(err);
																	res.end("fail");
																} else {
																	res.end("success");
																}
															});
														}
													});
												}
											})
										}
									});
								} else {
									User.find({teams: {$elemMatch: {"id": req.body.team_id} } }, function(err, users) {
										if (err) {
											console.error(err);
											res.end("fail");
										} else {
											if (users.length > 0) {
												user.teams.push({id: req.body.team_id, position: "member"});
												user.current_team = {id: req.body.team_id, position: "member"};
											} else {
												user.teams.push({id: req.body.team_id, position: "admin"});
												user.current_team = {id: req.body.team_id, position: "admin"};
											}
											AttendanceHandler.update({ entireTeam: true, event_date: { $gte: new Date() } }, {
												"$push": {
													"attendees": {user: req.user._id, status: "absent"}
												}
											}, function(err, model) {
												if (err) {
													console.error(err);
													res.end("fail");
												} else {
													user.save(function(err) {
														if (err) {
															console.error(err);
															res.end("fail");
														} else {
															Folder.create({
																name: "Personal Files",
																team: req.body.team_id,
																userMembers: req.user._id,
																creator: req.user._id,
																defaultFolder: true
															}, function(err, folder) {
																if (err) {
																	console.error(err);
																	res.end("fail");
																} else {
																	res.end("success");
																}
															});
														}
													});
												}
											})
										}
									});
								}
							}
						}
					});
				} else {
					res.end("no such team");
				}
			}
		});
	});
	app.post("/f/getTeamNum", requireLogin, function(req, res) {
		Team.findOne({id: req.user.current_team.id}, function(err, team) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				res.end(String(team.number));
			}
		})
	});
	app.post("/f/isTeamOnMorTeam", requireLogin, function(req, res) {
		Team.find({number: parseInt(req.body.teamNum)}, function(err, teams) {
			if (err) {
				console.error(err);
				res.end("fail");
			} else {
				if (teams.length > 0) {
					res.json(teams[0]);
				} else {
					res.end("false");
				}
			}
		});
	});
};
