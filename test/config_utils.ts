
export interface Config {
  host: string;
  port: number;
  connectHeaders: {
    host: string;
    login: string;
    passcode: string;
  };
};
