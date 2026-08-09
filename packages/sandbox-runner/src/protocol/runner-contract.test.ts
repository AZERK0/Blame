import assert from "node:assert/strict";
import test from "node:test";
import { runnerHandshake, runnerProtocolVersion } from "./runner-contract.js";

test("advertises the execution plan V2 runner protocol", () => {
  assert.equal(runnerProtocolVersion, 2);
  assert.deepEqual(
    runnerHandshake({
      runnerVersion: "0.2.5",
      imageDigest: "sha256:test",
      capabilities: {
        dockerCompose: true,
        sharedLoopback: true,
        snapshots: true,
        persistentFilesystem: true,
        publicHttpIngress: true,
        webSockets: true,
        networkPolicy: true,
        credentialBroker: false,
        bidirectionalSync: true,
        maxPublishedPorts: 15,
      },
    }),
    {
      protocolVersion: 2,
      runnerVersion: "0.2.5",
      imageDigest: "sha256:test",
      capabilities: {
        dockerCompose: true,
        sharedLoopback: true,
        snapshots: true,
        persistentFilesystem: true,
        publicHttpIngress: true,
        webSockets: true,
        networkPolicy: true,
        credentialBroker: false,
        bidirectionalSync: true,
        maxPublishedPorts: 15,
      },
    },
  );
});
