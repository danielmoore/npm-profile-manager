#!/usr/bin/env node

var Q = require('q');
var read = Q.nfbind(require('read'));
var colors = require('ansicolors');

var optimist = require('optimist')
  .usage(
    'Usage: npmrc [options] <command> [<profile>]\n\n' +
      'Commands:\n' +
      '  list, ls     Lists the available profiles and notes the current one (if any).\n' +
      '  switch, sw   Switches to the specified profile.\n' +
      '  create, mk   Creates a profile with the specified name.\n' +
      '  remove, rm   Removes the profile with the specified name.\n' +
      '  rename, mv   Renames the current profile to the specified name.\n' +
      '  upgrade, up  Creates a profile using the current npmrc.')
  .options({
    help: {
      alias: 'h',
      desc: 'Shows this message and quits.',
      boolean: true
    },
    version: {
      desc: 'Shows the version and quits.',
      boolean: true
    },
    force: {
      alias: 'f',
      desc: 'Forces the operation.',
      boolean: true
    }
  });

var argv = optimist.argv;

if (argv.version) {
  var pkg = require('../package.json');
  console.log(pkg.version);
  return;
}

if (argv.help) showHelp(0);

if (argv.debug) Q.longStackSupport = true;

var profileManager = require('../profile-manager');

var cmd = argv._[0], profile = argv._[1];
if (cmd) cmd = cmd.toLowerCase();
if (profile) profile = profile.toLowerCase();

var commands = {
  list: function () {
    return Q.all([
        profileManager.getCurrentProfileName(),
        profileManager.list()
      ])
      .spread(function (current, profiles) {
        profiles.forEach(function (profile) {
          var indicator = ' ';

          if (profile === current) {
            indicator = '*';
            profile = colors.green(profile);
          }

          console.log(indicator, profile);
        });
      })
  },

  switch: function () {
    if (!profile) showHelp(-1);

    return profileManager.switchTo(profile, argv.force)
      .then(function () {
        console.log("Switched to profile", profile);
      });
  },

  create: function () {
    if (!profile) showHelp(-1);

    return profileManager.create(profile, argv.force)
      .then(function () {
        console.log("Created profile", profile);
      })
      .then(this.switch);
  },

  remove: function () {
    if (!profile) showHelp(-1);

    return profileManager.getCurrentProfileName()
      .then(function (current) {
        if (current === profile)
          throw new Error('Cannot remove current profile.');

        return Q
          .fcall(function () {
            return argv.force || read({
              prompt: 'Are you sure you want to delete npmrc profile "' + profile + '" and its cache? [yes/no]',
              default: 'no'
            })
              .spread(function (response, cancel) {
                return !cancel && response.toLowerCase() === 'yes'
              })
          })
      })
      .then(function (confirmed) {
        if (confirmed)
          return profileManager.remove(profile)
            .then(function () {
              console.log('Removed profile', profile);
            });
        else {
          console.log("Aborted.");
          process.exit(0);
        }
      });
  },

  rename: function () {
    if (!profile) showHelp(-1);

    return profileManager.getCurrentProfileName()
      .then(function (current) {
        if (!current)
          throw new Error('No profile is currently active.');

        if (current === profile)
          process.exit(0);

        return profileManager.rename(current, profile, argv.force)
          .then(function () {
            console.log(current, 'is now named', profile);
          });
      })
      .then(this.switch);
  },

  upgrade: function () {
    return Q
      .fcall(function () {
        return profile || read({
          prompt: 'New profile name:'
        })
          .spread(function (response) {
            if (!response) {
              console.log('Aborted');
              process.exit(0);
            }

            return profile = response;
          });
      })
      .then(function (profile) {
        return profileManager.upgrade(profile, argv.force)
      })
      .then(this.switch);
  }
};

// Aliases
commands.ls = commands.list;
commands.sw = commands.switch;
commands.mk = commands.create;
commands.rm = commands.remove;
commands.mv = commands.rename;
commands.up = commands.upgrade;

if (!commands.hasOwnProperty(cmd)) showHelp(-1);

Q
  .invoke(commands, cmd)
  .done(null, function (err) {
    console.error(argv.debug ? err.stack : err.message);
    process.exit(-1);
  });

function showHelp(exitCode) {
  optimist.showHelp();
  process.exit(exitCode);
}
