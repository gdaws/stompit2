const { execSync } = require('child_process');
const package = require('./package.json');

const buildScripts = Object.keys(package.scripts).filter(v => v.match(/^build:/));

buildScripts.forEach(script => {

  try {
    const output = execSync(`npm run ${script}`);
    process.stdout.write(output);
  }
  catch(error) {
    
    process.stderr.write(error.stdout);
    process.stderr.write(error.stderr);

    process.exit(1);
  }
});
