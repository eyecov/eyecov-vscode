export interface ReportTheme {
  enabled: boolean;
  heading(value: string): string;
  success(value: string): string;
  warning(value: string): string;
  danger(value: string): string;
}

function wrap(enabled: boolean, code: string, value: string): string {
  return enabled ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export function createTheme(enabled: boolean): ReportTheme {
  return {
    enabled,
    heading(value: string): string {
      return wrap(enabled, "1;36", value);
    },
    success(value: string): string {
      return wrap(enabled, "32", value);
    },
    warning(value: string): string {
      return wrap(enabled, "33", value);
    },
    danger(value: string): string {
      return wrap(enabled, "31", value);
    },
  };
}

export function shouldUseColor(options: {
  stdoutIsTTY: boolean;
  noColor?: boolean;
  noColorEnv?: string | undefined;
}): boolean {
  return Boolean(
    options.stdoutIsTTY && !options.noColor && !options.noColorEnv,
  );
}
