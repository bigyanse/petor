import yargs from "yargs";
import toml from "toml";
import fs from "fs";
import path from "path";
import readline from "readline";
import Logger from "./utils/util.logger";
import { execSync } from "child_process";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const argv = yargs
  .scriptName("petor")
  .usage("Usage: $0 [OPTIONS] [ARGUMENTS]")
  .options({
    generate: { type: "string", describe: "Generate a template" },
    list: { type: "boolean", describe: "Show the list of available templates" },
    "get-template-dir": { type: "boolean", describe: "Get the templates directory" }
  })
  .example("$0 --generate backend restapi", "(Generate a `backend` named template as `restapi`)")
  .version()
  .help()
  .parseSync();

function flattenObject(obj: any, prefix = "petor"): Record<string, string> {
  let result: Record<string, string> = {};

  for (const key in obj) {
    if (!Object.hasOwnProperty.call(obj, key)) continue;

    const value = obj[key];
    const newKey = prefix + "." + key;

    if (value !== null && typeof value === "object") {
      // Recurse for nested objects
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = String(value);
    }
  }

  return result;
}

function readAllFilesRecursively(dir: string) {
  let results: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(readAllFilesRecursively(fullPath)); // recurse
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

const copyDirectory = (src: string, dest: string) => {
  const filesToCreate = fs.readdirSync(src);
  filesToCreate.forEach((file) => {
    const origFilePath = `${src}/${file}`;
    const stats = fs.statSync(origFilePath);
    if (stats.isFile()) {
      const contents = fs.readFileSync(origFilePath, "utf8");
      const writePath = `${dest}/${file}`;
      fs.writeFileSync(writePath, contents, "utf8");
    } else if (stats.isDirectory()) {
      fs.mkdirSync(`${dest}/${file}`);
      copyDirectory(`${src}/${file}`, `${dest}/${file}`);
    }
  });
};

const cloneProject = (projectUrl: string) => {
  try {
    const basename = path.basename(projectUrl, ".git");
    const tempProjectPath = path.resolve(`/tmp/.petor/${basename}`);
    if (fs.existsSync(tempProjectPath)) {
      Logger.warn("Project already exists in the temporary directory. Removing it before cloning again.");
      fs.rmSync(tempProjectPath, { recursive: true, force: true });
    }
    execSync(`git clone ${projectUrl} ${tempProjectPath}`, { stdio: "inherit" });
    if (!fs.existsSync(tempProjectPath)) {
      Logger.error("Failed to clone the project. Please check the URL and try again.");
      process.exit(1);
    }
    return tempProjectPath;
  } catch (err: any) {
    Logger.error("Failed to clone the project. Please check the URL and try again.");
    process.exit(1);
  }
};

function ask(query: string) {
  return new Promise(resolve => rl.question(query, resolve));
}

const configureProject = async (projectConf: any, prefix?: string) => {
  for (const key in projectConf) {
    if (Object.prototype.hasOwnProperty.call(projectConf, key)) {
      if (key === "slug") {
        projectConf["slug"] = projectConf["name"].toLowerCase().replace(/[^a-z0-9-]/g, "_").replace(/_{2,}/g, "_").replace(/^-|-$/g, "");
      }
      const value = projectConf[key];
      if (typeof value === "string") {
        const userInput = await ask(`${prefix + "_"}${key} (${value}): `);
        if (userInput) {
          projectConf[key] = (userInput as string).trim();
        }
      } else if (typeof value === "number") {
        const userInput = await ask(`${prefix + "_"}${key} (${value}): `);
        if (userInput) {
          projectConf[key] = (userInput as string).trim();
        }
        if (projectConf[key]) {
          const num = Number(projectConf[key]);
          if (!isNaN(num)) {
            projectConf[key] = num;
          } else {
            Logger.error(`Invalid number for ${prefix + "_"}${key}. Using default value: ${value}`);
            projectConf[key] = value;
          }
        }
      } else if (value !== null && typeof value === "object") {
        await configureProject(projectConf[key], `${key}`);
      } else {
        Logger.warn(`Unsupported type for ${prefix + "_"}${key}. Please check the petor.toml file.`);
        process.exit(1);
      }
    }
  }
};

const createProject = (templateName: string, projectName: string) => {
  const projectFolder = path.resolve(process.cwd() + "/" + projectName);
  const templateFolder = path.resolve(__dirname, "../../templates/", templateName);
  if (!fs.existsSync(templateFolder)) return Logger.error("No such template. Use `--list` option to see the list of templates.");
  if (fs.existsSync(projectFolder)) {
    return Logger.error("Folder already exists! Move the existing folder somewhere or rename the project to something else.");
  }
  fs.mkdirSync(projectFolder);
  copyDirectory(templateFolder, projectFolder);
  Logger.info(`[Generated] ${argv.generate} has been generated!`);
};

const getDirectories = (dir: string) => {
  return fs.readdirSync(path.resolve(__dirname, dir), { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
};

const main = async () => {
  if ((argv.generate || argv.generate === "") && argv.list && argv._.length > 0) {
    return Logger.error("Only one option can be used at a time");
  }

  if (argv._.length === 1 && typeof argv._[0] === "string") {
    // clone project to temp space
    const tempProjectDirectory = cloneProject(argv._[0]);
    console.log(tempProjectDirectory);

    // cleanup redundant files and dirs
    fs.rmSync(path.resolve(tempProjectDirectory, ".git"), { recursive: true, force: true });

    // read petor.toml file inside the project
    const petorTomlPath = path.resolve(tempProjectDirectory, "petor.toml");
    if (!fs.existsSync(petorTomlPath)) {
      return Logger.error("No petor.toml file found in the project directory.");
    }

    const petorTomlContent = fs.readFileSync(petorTomlPath, "utf8");
    const projectConf = toml.parse(petorTomlContent);

    // take use input for project configuration
    await configureProject(projectConf);

    // copy the project to current working directory
    const projectDir = path.resolve(process.cwd() + "/" + projectConf.project.slug);
    if (fs.existsSync(projectDir)) {
      return Logger.error("Project directory already exists! Move the existing folder somewhere or rename the project to something else.");
    }
    fs.mkdirSync(projectDir);
    copyDirectory(path.resolve(tempProjectDirectory, "{{ petor.project.slug }}"), projectDir);
    const allFiles = readAllFilesRecursively(projectDir);
    const replacements = flattenObject(projectConf);

    allFiles.forEach((file) => {
      let contents = fs.readFileSync(file, "utf8");

      for (const key in replacements) {
        const pattern = new RegExp(`{{\\s*${key.replace(/\./g, "\\.")}\\s*}}`, "g");
        contents = contents.replace(pattern, replacements[key]);
      }

      fs.writeFileSync(file, contents, "utf8");
    });
    process.exit(0);
  } else if (argv.generate || argv.generate === "") {
    if (argv.generate === "") {
      const help = await yargs.getHelp();
      console.log(help, "\n");
      return Logger.error("Missing required arguments for --generate: <template> <project-name>");
    }
    if (argv._.length === 1 && typeof argv._[0] === "string") {
      createProject(argv.generate, argv._[0]);
    } else if (argv._.length === 0) {
      createProject(argv.generate, argv.generate);
    } else {
      return Logger.error("");
    }
  } else if (argv.list) {
    console.log("List of templates:\n");
    const dirs = getDirectories("../../templates");
    dirs.map((dir, i) => {
      console.log(`${i}) ${dir}`);
    });
  } else if (argv["get-template-dir"]) {
    console.log("Template directory: ", path.resolve(__dirname, "../../templates"))
  } else {
    const help = await yargs.getHelp();
    console.log(help);
  }
};

main();
