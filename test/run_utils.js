const { spawnSync } = require('child_process');

function run(command, args) {

  const result = spawnSync(command, args, {
    shell: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`Exit status ${result.status}: ${getOutput(result.stderr)}`);
    Object.assign(error, result);
    throw error;
  }

  return getOutput(result.stdout);
}

function getOutput(content) {
  if (content instanceof Buffer) {
    return content.toString();
  }
  return content;
}

function inspectContainer(name) {

  try {
    const list = JSON.parse(run('docker', ['container', 'inspect', name]));
    if (Array.isArray(list)) {
      return list[0];
    }
    else return;
  }
  catch(error) {
    return;
  }
}

function removeContainer(name) {
  try { run('docker', ['container', 'rm', '-f', name]); } catch(error) {}
}

function stopContainer(name) {
  run('docker', ['container', 'stop', name]);
}

function main(availableCommands) {

  const commandName = process.argv[2] || 'defaultCommand';

  const commandFunction = availableCommands[commandName];

  if (!commandFunction) {
    process.stderr.write(`Unknown command: ${commandName}\n`);
    process.exit(1);
  }

  (async function () {
    try {
      await commandFunction();
      process.exit(0);
    }
    catch(error) {
      process.stderr.write(error.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  run,
  inspectContainer,
  stopContainer,
  removeContainer,
  main
};
