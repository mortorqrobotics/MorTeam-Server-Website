/**
 * The server for http://www.morteam.com
 * @author      Farbod Rafezy <rafezyfarbod@gmail.com>
 * @version     1.0.0-beta.4
 */

//import necessary modules
var express = require('express');
var http = require('http');
var fs = require('fs');
var bodyParser = require('body-parser');
var mongoose = require('mongoose'); //MongoDB ODM
var session = require('express-session');
var MongoStore = require('connect-mongo')(session);
var ObjectId = mongoose.Types.ObjectId; //this is used to cast strings to MongoDB ObjectIds
var config = require("./config.json"); //contains passwords and other sensitive info
var util = require("./util.js")(); //contains functions and objects that are used across all the modules
var multer = require('multer'); //for file uploads

//create express application and define global static directories
var app = express();
publicDir = require("path").join(__dirname, "../website/public");
profpicDir = 'http://profilepics.morteam.com.s3.amazonaws.com/'

//import mongodb schemas
var schemas = {
  User: require('./schemas/User.js'),
  Team: require('./schemas/Team.js'),
  Subdivision: require('./schemas/Subdivision.js'),
  Announcement: require('./schemas/Announcement.js'),
  Chat: require('./schemas/Chat.js'),
  Event: require('./schemas/Event.js'),
  AttendanceHandler: require('./schemas/AttendanceHandler.js'),
  Folder: require('./schemas/Folder.js'),
  File: require('./schemas/File.js'),
  Task: require('./schemas/Task.js'),
}

//assign variables to imported util functions(and objects) and database schemas (example: var myFunc = util.myFunc;)
for(key in util){
  eval("var " + key + " = util." + key + ";");
}
for(key in schemas){
  eval("var " + key + " = schemas." + key + ";");
}

//connect to mongodb server
mongoose.connect('mongodb://localhost:27017/' + config.dbName);

//start server
var port = process.argv[2] || 8080;
var io = require("socket.io").listen(app.listen(port, "172.31.31.34"));
console.log('server started on port %s', port);

//check for any errors in all requests
app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500).send('Oops, something went wrong!');
});

//middleware to get request body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

var sessionMiddleware = session({
  secret: config.sessionSecret,
  saveUninitialized: false,
  resave: false,
  store: new MongoStore({ mongooseConnection: mongoose.connection })
});

//can now use session info (cookies) with socket.io requests
io.use(function(socket, next){
  sessionMiddleware(socket.request, socket.request.res, next);
});
//can now use session info (cookies) with regular requests
app.use(sessionMiddleware);

//load user info from session cookie into req.user object for each request
app.use(function(req, res, next) {
  if (req.session && req.session.user) {
    User.findOne({
      username: req.session.user.username
    }, function(err, user) {
      if (user) {
        req.user = user;
        delete req.user.password;
        req.session.user = user;
      }
      next();
    });
  } else {
    next();
  }
});

//add .html to end of filename if it did not have it already
app.use(function(req, res, next) {
  if (req.path.indexOf('.') === -1) {
    var file = publicDir + req.path + '.html';
    fs.exists(file, function(exists) {
      if (exists)
        req.url += '.html';
      next();
    });
  } else
    next();
});

//check to see if user is logged in before continuing any further
//allow browser to receive images, css, and js files without being logged in
//allow browser to receive some pages such as login.html, signup.html, etc. without being logged in
app.use(function(req, res, next) {
  var exceptions = ["/login.html", "/signup.html", "/fp.html", "/favicon.ico"];
  if (req.method == "GET") {
    if (req.path.contains("/css/") || req.path.contains("/js/") || req.path.contains("/img/")) {
      next();
    } else if ( exceptions.indexOf(req.url) > -1 ) {
      next();
    } else if (req.url == "/void.html") {
      if (req.user) {
        if (req.user.teams.length > 0) {
          if(!req.user.current_team){
            req.session.user.current_team.id = req.user.teams[0].id;
            req.session.user.current_team.position = req.user.teams[0].position;
            req.user.current_team.id = req.user.teams[0].id;
            req.user.current_team.position = req.user.teams[0].position;
          }
          res.redirect("/");
        } else {
          next();
        }
      } else {
        res.redirect("/");
      }
    } else {
      if (req.user) {
        if (req.user.teams.length > 0) {
          next();
        } else {
          res.redirect("/void");
        }
      } else {
        res.redirect("/login");
      }
    }
  } else {
    next();
  }
});

//load any file in /website/public (aka publicDir)
app.use(express.static(publicDir));

//use EJS as default view engine and specifies location of EJS files
app.set('view engine', 'ejs');
app.set('views', __dirname + '/../website');

//load homepage
app.get("/", function(req, res) {
  fs.createReadStream("../website/public/index.html").pipe(res);
});

//import all modules that handle specific GET and POST requests
require("./accounts.js")(app, util, schemas);
require("./teams.js")(app, util, schemas);
require("./subdivisions.js")(app, util, schemas);
require("./announcements.js")(app, util, schemas);
require("./chat.js")(app, util, schemas);
require("./drive.js")(app, util, schemas);
require("./events.js")(app, util, schemas);
require("./tasks.js")(app, util, schemas);
require("./sio.js")(io, util, schemas);

//send 404 message for any page that does not exist (IMPORTANT: The order for this does matter. Keep it at the end.)
app.get('*', function(req, res) {
  send404(res);
});
