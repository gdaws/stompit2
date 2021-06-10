
export interface Config {
  moduleName: string;
  host: string;
  port: number;
  connectHeaders: {
    host: string;
    login: string;
    passcode: string;
  };
};
