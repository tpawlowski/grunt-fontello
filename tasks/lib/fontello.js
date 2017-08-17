// TODO: Clean up comments

var fs      = require('fs');
var path    = require('path');
var async   = require('async');
var needle  = require('needle');
var unzip   = require('unzip');
var mkdirp  = require('mkdirp');
var grunt   = require('grunt');

/* Verify or build paths */
var processPath = function(options, dir, callback){
  fs.exists(dir, function(exists){
    if(!exists) {
      if(!options.force) {
        callback(dir + ' missing! use `force:true` to create');
      } else {
        // Force create path
        mkdirp(dir, function(err){
          if (err) { callback(err); }
          else {
            callback(null, dir + ' created!');
          }
        });
      }
    } else {
      callback(null, dir + ' verified!');
    }
  });
};

var getSession = function(){
  var src = path.resolve(process.cwd(), 'node_modules/grunt-fontello/session');

  // Make sure the session file exists, return `null`
  // if it doesn't
  if (!fs.existsSync(src)) {
    return null;
  }

  // Read session from the session file.
  return fs.readFileSync(src, { encoding: 'utf-8'});
}

var setSession = function(session){
  var dest = path.resolve(process.cwd(), 'node_modules/grunt-fontello/session');

  // Write session to the session file since the Fontello
  // api dislikes custom members.
  fs.writeFileSync(dest, session);
}

/*
* Initial Checks
* @callback: options
* */
var init = function(options, callback){

  grunt.log.write('Verify paths...');
  var tests = [
    processPath.bind(null, options, options.fonts),
    processPath.bind(null, options, options.styles)
  ];
  async.parallel(options.styles ? tests : [tests[0]], function(err, results){
    if(err) {
      grunt.log.error(err);
      callback(err);
    }
    else {
      grunt.log.ok();
      results.forEach(function(result){
        grunt.log.debug(result);
      });
      callback(null, options);
    }
  });

};

/*
* Create Session
* URL: http://fontello.com
* POST: config.json
* @callback: session id
* */
var createSession = function(options, callback){

  var data = {
    config: {
      file: options.config,
      content_type: 'application/json'
    }
  };

  var session = getSession();

  if (session !== null) {
    callback(null, options, session);
  }
  else {
    grunt.log.write('Creating session...');
    needle.post( options.host, data, { multipart: true }, function(err, res, body){
         if (err) {
           grunt.log.error();
           callback(err);
         }
         else {
           grunt.log.ok();
           grunt.log.debug('sid: ' + body);

           // Store the new sid and continue
           setSession(body);
           callback(null, options, body);
         }
       }
    );
  }

};

/*
* Download Archive
* URL: http://fontello.com
* GET: http://fontello.com/SESSIONID/get
* callback: fetch/download result
**/
var fetchStream = function(options, session, callback){

  // The Fontello api outputs an error message instead of a session id if the
  // config file contains unexpected data. Pass that error on.
  if (/Invalid/.test(session))
    throw new Error(session);

  var getOptions = {
    follow: 10
  };
  var tempZip = process.cwd() + '/fontello-tmp.zip';

  grunt.log.write('Fetching archive...');
  needle.get(options.host + '/' + session + '/get', getOptions, function(err, response, body){

    if (err) {
      throw err;
    }

    if(response.statusCode == 404)
    {
      setSession(options, '');
	  createSession(options, fetchStream);
    }
    else
    {
      fs.writeFileSync(tempZip, body);
      var readStream = fs.createReadStream(tempZip);

      /* Extract Files */
      if(options.fonts || options.styles) {
      return readStream.pipe(unzip.Parse())
        // TODO: fix inconsistent return point
        .on('entry', function(entry){
          var ext = path.extname(entry.path);
          var name = path.basename(entry.path);

          if(entry.type === 'File') {
            if(options.exclude.indexOf(name) !== -1) {
                grunt.verbose.writeln('Ignored ', entry.path);
                entry.autodrain();
            } else {
              switch(ext){
              // Extract Fonts
              case '.woff':case '.svg': case '.ttf': case '.eot': case '.woff2':
                var fontPath = path.join(options.fonts, path.basename(entry.path));
                return entry.pipe(fs.createWriteStream(fontPath));
              // Extract CSS
              case '.css':
                // SCSS:
                if (options.styles) {
                  var cssPath = (!options.scss) ?
                  path.join(options.styles, path.basename(entry.path)) :
                  path.join(options.styles, '_' + path.basename(entry.path).replace(ext, '.scss'));
                  return entry.pipe(fs.createWriteStream(cssPath));
                }
              // Drain everything else
              default:
                grunt.verbose.writeln('Ignored ', entry.path);
                entry.autodrain();
              }
            }
          }
        })
        .on('close', function(){
           fs.unlinkSync(tempZip);
           grunt.log.ok();
           callback(null, 'extract complete');
        });
      }
      /* Extract full archive */
      return readStream.pipe(unzip.Extract({ path: options.zip }))
        .on('close', function(){
          grunt.log.ok();
          fs.unlinkSync(tempZip);
          callback(null, 'Fontello extracted to '+options.zip);
      });
    }
    if(err){
      grunt.log.err();
      callback(err);
    }
  });


};

module.exports = {
  init    : init,
  post    : createSession,
  fetch   : fetchStream
 };
