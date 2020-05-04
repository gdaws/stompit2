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

module.exports = {
  run,
  inspectContainer,
  stopContainer,
  removeContainer
};
