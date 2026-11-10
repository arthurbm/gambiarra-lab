import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalDirectoryWorkspace,
  type WorkspaceArtifactFile,
} from "gambi-sdk";

import { createCityTileWorkspace } from "../starter/city-tile";

const context = {
  harness: "fake",
  model: "fake-event",
  participantId: "board-hosted-01",
  roomCode: "ROOM74",
};

test("seeds the city tile starter into a gambi-sdk workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-city-workspace-"));
  try {
    const workspace = createCityTileWorkspace(
      createLocalDirectoryWorkspace({ path: directory })
    );
    const prepared = await workspace.prepare(context);

    expect(prepared.path).toBe(directory);
    expect(await Bun.file(join(directory, ".gambi.json")).json()).toEqual(
      context
    );
    const files: WorkspaceArtifactFile[] = await prepared.collect();
    expect(files.map((file) => file.path).toSorted()).toEqual([
      "README.md",
      "index.html",
      "manifest.json",
    ]);
    const manifest = JSON.parse(
      files.find((file) => file.path === "manifest.json")?.content ?? "{}"
    );
    expect(manifest.palette).toBeDefined();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps files a harness already wrote when prepared again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-city-workspace-"));
  try {
    const workspace = createCityTileWorkspace(
      createLocalDirectoryWorkspace({ path: directory })
    );
    await workspace.prepare(context);
    await writeFile(join(directory, "index.html"), "<p>edited</p>\n");

    await workspace.prepare(context);

    expect(await Bun.file(join(directory, "index.html")).text()).toBe(
      "<p>edited</p>\n"
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
