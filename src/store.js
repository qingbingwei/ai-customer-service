import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    const content = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(content);
  }

  async update(mutator) {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return result;
    });
    return this.writeQueue;
  }
}
