
export type HeaderName = string;
export type HeaderValue = string;
export type HeaderValueOptional = HeaderValue | undefined;
export type HeaderLine = [HeaderName, HeaderValue];
export type HeaderLineOptional = [HeaderName, HeaderValueOptional];
export type HeaderMap = {[name: string]: HeaderValue};
export type HeaderMapOptional = {[name: string]: HeaderValueOptional};

export class FrameHeaders {

  private lines: HeaderLine[]; 
  private map: HeaderMap;

  public constructor(lines: HeaderLineOptional[] = []) {

    this.lines = [];
    this.map = {};

    for (const [name, value] of lines) {
      if (undefined !== value) {
        this.appendLine(name, value);
      }
    }
  }

  public static none() {
    return new FrameHeaders([]);
  }

  public static fromEntries(entries: HeaderLineOptional[]) {
    return new FrameHeaders(entries);
  }

  public static fromMap(map: HeaderMapOptional) {

    const result = new FrameHeaders();

    Object.entries(map).forEach(([name, value]) => {
      if (undefined !== value) {
        result.appendLine(name, value);
      }
    });

    return result;
  }

  public filter(callback: (line: HeaderLine) => boolean) {
    return new FrameHeaders(this.lines.filter(callback));
  }

  public static concat(...headers: FrameHeaders[]) {

    const result = new FrameHeaders();

    result.lines = ([] as HeaderLine[]).concat(...headers.map(o => o.lines));
    result.map = Object.assign({}, ...headers.reverse().map(o => o.map));

    return result;
  }

  public static merge(...headers: FrameHeaders[]) {

    const result = new FrameHeaders();

    result.map = Object.assign({}, ...headers.map(o => o.map));
    result.lines = Object.entries(result.map);

    return result;
  }

  private appendLine(name: HeaderName, value: HeaderValue) {

    const nameLc = name.toLowerCase();

    if (!this.map.hasOwnProperty(nameLc)) {
      this.map[nameLc] = value;
    }

    this.lines.push([nameLc, value]);
  }

  public get(name: HeaderName): HeaderValue | undefined {
    return this.map[name.toLowerCase()];
  }

  public has(name: HeaderName): boolean {
    const value = this.map[name.toLowerCase()];
    return value !== undefined && value.length > 0;
  }

  public getAll(target: HeaderName): HeaderValue[] {
    const targetNameLc = target.toLowerCase();
    return this.lines.filter(([name, _]) => targetNameLc === name).map(([_, value]) => value);
  }

  public required(...names: HeaderName[]): Error | undefined {
    
    for (const name of names) {
      if (!this.has(name)) {
        return new Error(`missing ${name} header`);
      }
    }
  }

  public [Symbol.iterator](): Iterator<HeaderLine> {
    return this.lines.values();
  }
};

export function headers(values: HeaderMap) {
  return FrameHeaders.fromMap(values);
}
