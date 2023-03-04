import { Logger, TLogLevelName } from "tslog";
import { logger as constants } from "@app/constants";

type ConsoleLogger = Logger & {
    log?: Logger["info"];
};

const console: ConsoleLogger = new Logger({
    name: "GiTM",
    displayFunctionName: false,
    minLevel: <TLogLevelName>(constants?.level || "debug"),
    dateTimePattern: "hour:minute:second",
    dateTimeTimezone: "America/New_York",
    displayFilePath: constants?.debug ? "hideNodeModulesOnly" : "hidden"
});

/* Add the console#log alias. */
console["log"] = console.info;

export default console;