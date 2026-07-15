import { describe, expect, it, vi } from "vitest";
import { heartbeatSweep, markAlive, publish, registerConnection, unregisterConnection } from "./hub";

function fakeSocket() {
  return {
    readyState: 1,
    OPEN: 1,
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  } as unknown as import("ws").WebSocket;
}

describe("ws/hub — connection registry and fanout", () => {
  it("publish with no recipientIds reaches every connection (org-wide events)", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    const idA = registerConnection(a, "person-a");
    const idB = registerConnection(b, "person-b");

    publish({ type: "capacity-ranking" });

    expect(a.send).toHaveBeenCalledWith(JSON.stringify({ type: "capacity-ranking" }));
    expect(b.send).toHaveBeenCalledWith(JSON.stringify({ type: "capacity-ranking" }));

    unregisterConnection(idA);
    unregisterConnection(idB);
  });

  it("publish with recipientIds only reaches matching connections -- never broadcasts everything to everyone", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    const idA = registerConnection(a, "person-a");
    const idB = registerConnection(b, "person-b");

    publish({ type: "project", projectId: "p1" }, new Set(["person-a"]));

    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).not.toHaveBeenCalled();

    unregisterConnection(idA);
    unregisterConnection(idB);
  });

  it("unregistered connections never receive anything", () => {
    const a = fakeSocket();
    const idA = registerConnection(a, "person-a");
    unregisterConnection(idA);

    publish({ type: "capacity-ranking" });

    expect(a.send).not.toHaveBeenCalled();
  });

  it("heartbeatSweep terminates a connection that never pongs, but keeps one that does", () => {
    const dead = fakeSocket();
    const alive = fakeSocket();
    const idDead = registerConnection(dead, "person-dead");
    const idAlive = registerConnection(alive, "person-alive");

    heartbeatSweep(); // first sweep: both start alive, both get pinged
    expect(dead.ping).toHaveBeenCalledTimes(1);
    expect(alive.ping).toHaveBeenCalledTimes(1);
    expect(dead.terminate).not.toHaveBeenCalled();

    markAlive(idAlive); // simulate alive's pong arriving; dead never responds

    heartbeatSweep(); // second sweep: dead never marked alive -> terminated; alive -> pinged again
    expect(dead.terminate).toHaveBeenCalledTimes(1);
    expect(alive.terminate).not.toHaveBeenCalled();
    expect(alive.ping).toHaveBeenCalledTimes(2);

    unregisterConnection(idAlive);
  });
});
