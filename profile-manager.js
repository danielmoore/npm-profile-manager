'use strict';

var Q = require('q');
var npmconf = require('npmconf');
var exec = require('child_process').exec;
var path = require('path');
var fs = require('fs');
var rimraf = Q.nfbind(require('rimraf'));
var mkdirp = Q.nfbind(require('mkdirp'));

var getConfig = function () {
  var promise = Q
    // strangely, this is the best way to find where the installed version of npm thinks the .npmrc file is.
    .nfcall(exec, 'npm -g config get userconfig')
    .then(function (result) {
      return result[0].trimRight();
    })
    .then(function (npmConfigPath) {
      var getNpmrcPath = path.resolve.bind(null, npmConfigPath, '../.npmrcs');
      var getProfileDirPath = getNpmrcPath.bind(null, 'profiles');

      return {
        npmConfigPath: npmConfigPath,
        npmrcDirPath: getNpmrcPath(),
        getProfileDirPath: getProfileDirPath,
        getProfilePath: function (profile) { return getProfileDirPath(profile, 'npmrc'); },
        getProfileCachePath: function (profile) { return getProfileDirPath(profile, 'cache'); }
      };
    });

  getConfig = function () { return promise; };
  return promise;
};

exports.create = create;
function create(profile, force) {
  return getConfig()
    .then(function (config) {
      return makeProfileHome(profile, force)
        .then(function () {
          var profilePath = config.getProfilePath(profile);
          return Q.nfcall(fs.writeFile, profilePath, '', { mode: '0600' })
        })
    })
}

exports.getCurrentProfileName = getCurrentProfileName;
/**
 * @returns {*} null when no npmrc exists;
 *              false when the file is not managed;
 *              the name of the managed profile.
 */
function getCurrentProfileName() {
  return getConfig()
    .then(function (config) {
      return Q
        .nfcall(fs.realpath, config.npmConfigPath)
        .then(function (realpath) {
          var profile = path.basename(path.dirname(realpath));

          return realpath === config.getProfilePath(profile) && profile;
        }, function (err) {
          if (err.code === 'ENOENT') // path does not exist
            return null;

          throw err;
        });
    });
}

exports.upgrade = upgrade;
function upgrade(profile, force) {
  return makeProfileHome(profile, force)
    .then(getConfig)
    .then(function (config) {
      return Q
        .nfcall(fs.lstat, config.npmConfigPath) // lstat looks at the link itself, not the target.
        .then(function (stats) {
          if (!stats.isFile())
            throw new Error('Not a regular file: ' + config.npmConfigPath);

          var profilePath = config.getProfilePath(profile);
          return Q.nfcall(fs.rename, config.npmConfigPath, profilePath);
        });
    });
}

function makeProfileHome(profile, force) {
  return getConfig()
    .invoke('getProfileDirPath', profile)
    .then(function (profileDirPath) {
      return mkdirp(profileDirPath)
        .catch(function (err) {
          if (!force) throw err;
          return rimraf(profileDirPath)
            .then(function () {
              return Q.nfcall(fs.mkdir, profileDirPath);
            });
        })
    });
}

exports.remove = remove;
function remove(profile) {
  return getConfig()
    .then(function (config) {
      return rimraf(config.getProfileDirPath(profile));
    });
}

exports.switchTo = switchTo;
function switchTo(profile, force) {
  return  getConfig()
    .then(function (config) {
      var profilePath = config.getProfilePath(profile);
      return fileExists(profilePath)
        .then(function(exists) {
            if (!exists)
              throw new Error('Profile "' + profile + '" does not exist.');
        })
        // check current state
        .then(function () {
          return force || getCurrentProfileName()
            .then(function (currentProfile) {
              if (currentProfile === false)
                throw new Error('Current npmrc is not a managed profile, i.e. it does not point to a file in ' +
                  config.getProfileDirPath());
            })
        })
        // remove old link
        .then(function () {
          // use rimraf just in case it's a dir for some reason.
          return rimraf(config.npmConfigPath)
            .catch(function (err) {
              if (err.code === 'ENOENT')
                return; // file doesn't exist... whatever.

              throw err;
            });
        })
        // make new symlink
        .then(function () {
          return Q.nfcall(fs.symlink, profilePath, config.npmConfigPath);
        })
        .then(function () {
          ensureCachePath(config.getProfileCachePath(profile));
        });
    })
}

exports.rename = rename;
function rename(from, to, force) {
  return getConfig()
    .then(function (config) {
      var fromProfileDirPath = config.getProfileDirPath(from);
      var toProfileDirPath = config.getProfileDirPath(to);

      return Q
        .nfcall(fs.rename, fromProfileDirPath, toProfileDirPath)
        .catch(function (err) {
          if (force && (err.code === 'ENOTEMPTY' || err.code === 'EEXIST'))
            return rimraf(toProfileDirPath)
              .then(function () {
                return Q.nfcall(fs.rename, fromProfileDirPath, toProfileDirPath);
              });

          throw err;
        });
    })
}

exports.list = list;
function list() {
  return getConfig()
    .then(function (config) {
      return Q.nfcall(fs.readdir, config.getProfileDirPath());
    })
    .catch(function (err) {
      if (err.code === 'ENOENT') // does not exist
        return [];
      throw err;
    });
}

function ensureCachePath(cachePath) {
  npmconf.loaded = null; // just in case something was loaded before...

  return Q
    .nfcall(npmconf.load)
    .then(function (conf) {
      if (conf.get('cache') === cachePath) return null;

      conf.set('cache', cachePath, 'user');
      return Q.ninvoke(conf, 'save', 'user');
    })
}

function fileExists(path) {
  var deferred = Q.defer();
  fs.exists(path, deferred.resolve);
  return deferred.promise;
}
