import { simpleGit, type SimpleGit } from "simple-git";
import path from "node:path";

/** Runs async tasks strictly one after another; a failing task does not poison the chain. */
export class Queue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export interface CommitAuthor {
  name: string;
  email: string;
}

/** All git operations for one repository, funnelled through a single promise chain (no `.git/index.lock` races). */
export class GitQueue {
  private readonly queue = new Queue();
  private readonly git: SimpleGit;

  constructor(readonly dir: string) {
    this.git = simpleGit({ baseDir: dir });
  }

  /** `git init` (idempotent); ensures a committer identity exists locally if none is configured. */
  init(): Promise<void> {
    return this.queue.run(async () => {
      await this.git.init();
      for (const [key, fallback] of [["user.name", "Memex"], ["user.email", "memex@localhost"]] as const) {
        const current = (await this.git.raw(["config", "--get", key]).catch(() => "")).trim();
        if (!current) await this.git.addConfig(key, fallback, false, "local");
      }
    });
  }

  addRemote(name: string, url: string): Promise<void> {
    return this.queue.run(async () => {
      await this.git.addRemote(name, url);
    });
  }

  /**
   * Stage and commit exactly `files` (POSIX paths relative to the repo) as one commit.
   * Returns the new commit SHA, or null if the files had no changes.
   */
  commit(files: string[], message: string, author?: CommitAuthor): Promise<string | null> {
    return this.queue.run(async () => {
      await this.git.add(files.map((f) => path.posix.normalize(f)));
      const staged = await this.git.raw(["diff", "--cached", "--name-only", "--", ...files]);
      if (staged.trim() === "") return null;
      const options = author ? { "--author": `${author.name} <${author.email}>` } : undefined;
      await this.git.commit(message, files, options);
      return (await this.git.revparse(["HEAD"])).trim();
    });
  }

  /** Stage everything and commit (used for the vault's initial commit). */
  commitAll(message: string): Promise<string> {
    return this.queue.run(async () => {
      await this.git.add(["-A"]);
      await this.git.commit(message);
      return (await this.git.revparse(["HEAD"])).trim();
    });
  }
}

const queues = new Map<string, GitQueue>();

/** One shared GitQueue per repository directory, so every caller serializes on the same chain. */
export function gitFor(dir: string): GitQueue {
  const key = path.resolve(dir);
  let queue = queues.get(key);
  if (!queue) queues.set(key, (queue = new GitQueue(key)));
  return queue;
}
