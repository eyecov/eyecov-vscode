import { runReportCli } from "../src/report/cli-main";

void runReportCli().then((exitCode) => {
  process.exitCode = exitCode;
});
