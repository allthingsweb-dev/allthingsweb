import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * `db` over TCP, as the Worker will read Hyperdrive: its connection string,
 * and `stop`, which closes the server and the database.
 */
export async function serve(db: PGlite) {
  const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 8 });
  await server.start();
  return {
    url: `postgres://postgres:postgres@${server.getServerConn()}/postgres`,
    stop: async () => {
      await server.stop();
      // A socket the server just closed still runs its close handler, which
      // asks the database about its transaction: let it, before closing it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await db.close();
    },
  };
}
