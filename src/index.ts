if (process.env["NODE_ENV"] === "dev") {
    require("tsconfig-paths/register");
}

console.clear();

/* Load application constants. */
import "@app/constants";

/* Start the server. */
import "@app/server";