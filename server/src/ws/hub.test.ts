import { describe, expect, it, vi } from "vitest";
import { closeAllConnections, heartbeatSweep, markAlive, publish, registerConnection, unregisterConnection } from "./hub";

function fakeSocket(readyState = 1) {
  return {
    readyState,
    OPEN: 1,
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
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

  it("closeAllConnections closes every open socket with the going-away code and empties the registry", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    registerConnection(a, "person-a");
    registerConnection(b, "person-b");

    closeAllConnections();

    expect(a.close).toHaveBeenCalledWith(1001, "server shutting down");
    expect(b.close).toHaveBeenCalledWith(1001, "server shutting down");

    // Registry is emptied: a subsequent publish reaches no one.
    publish({ type: "capacity-ranking" });
    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).not.toHaveBeenCalled();
  });

  it("closeAllConnections skips a socket that is already closing but still clears it", () => {
    const closing = fakeSocket(2); // CLOSING, not OPEN
    registerConnection(closing, "person-c");

    closeAllConnections();

    expect(closing.close).not.toHaveBeenCalled();
    publish({ type: "capacity-ranking" });
    expect(closing.send).not.toHaveBeenCalled();
  });
});
