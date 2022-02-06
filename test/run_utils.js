// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawnSync, spawn } = require('child_process');

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
  catch (error) {
    return;
  }
}

function removeContainer(name) {
  try {
    run('docker', ['container', 'rm', '-f', name]);
  }
  catch (error) { }
}

function stopContainer(name) {
  run('docker', ['container', 'stop', name]);
}

function waitContainerOutput(containerName, pattern, timeout) {
  return new Promise((resolve, reject) => {
    const logViewerProcess = spawn('docker', ['logs', '--follow', containerName], { shell: true });

    let output = '';
    let finished = false;
    let timer;

    const finish = (value) => {
      if (finished) {
        return;
      }

      if (null !== timer) {
        clearTimeout(timer);
      }

      if (null === logViewerProcess.exitCode) {
        logViewerProcess.kill('SIGINT');
      }

      finished = true;

      if (value instanceof Error) {
        reject(value)
      }
      else {
        resolve(value);
      }
    };

    if (timeout > 0 && timeout < Infinity) {
      timer = setTimeout(() => finish(new Error('timed out waiting for output')), timeout);
    }

    const matchOutput = () => {
      const value = output.match(pattern);

      if (null === value) {
        return;
      }

      finish(value);
    };

    logViewerProcess.stdout.on('data', (chunk) => {
      if (chunk instanceof Buffer) {
        output = output + chunk.toString('utf-8');
      }
      else {
        output = output + chunk;
      }

      matchOutput();
    });

    logViewerProcess.on('exit', () => {
      finish(new Error('log viewer process exited with code ' + logViewerProcess.exitCode));
    });
  });
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
    catch (error) {
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
  waitContainerOutput,
  main
};
