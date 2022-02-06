import { acceptedVersions, supportedProtocolVersion, acceptedAckModes, getAckMode } from './protocol';

test('acceptedVersions', () => {
  const versions = acceptedVersions();

  expect(versions[0]).toBe('1.0');
  expect(versions[1]).toBe('1.1');
  expect(versions[2]).toBe('1.2');
});

test('supportedProtocolVersion', () => {
  expect(supportedProtocolVersion('1.0')).toBe('1.0');
  expect(supportedProtocolVersion('1.1')).toBe('1.1');
  expect(supportedProtocolVersion('1.2')).toBe('1.2');

  expect(supportedProtocolVersion('blah')).toBeUndefined();
});

test('acceptedAckModes', () => {
  acceptedAckModes('1.0');

  expect(acceptedAckModes('1.0')).toEqual(['auto', 'client', 'client-individual']);
  expect(acceptedAckModes('1.1')).toEqual(['auto', 'client', 'client-individual']);
  expect(acceptedAckModes('1.2')).toEqual(['auto', 'client', 'client-individual']);
});

test('getAckMode', () => {
  expect(getAckMode(undefined, '1.0')).toBe('auto');
  expect(getAckMode('client', '1.0')).toBe('client');
  expect(getAckMode('client-individual', '1.0')).toBe('client-individual');
  expect(getAckMode('blah', '1.0')).toBeUndefined();

  expect(getAckMode(undefined, '1.1')).toBe('auto');
  expect(getAckMode('client', '1.1')).toBe('client');
  expect(getAckMode('client-individual', '1.1')).toBe('client-individual');
  expect(getAckMode('blah', '1.1')).toBeUndefined();

  expect(getAckMode(undefined, '1.2')).toBe('auto');
  expect(getAckMode('client', '1.2')).toBe('client');
  expect(getAckMode('client-individual', '1.2')).toBe('client-individual');
  expect(getAckMode('blah', '1.2')).toBeUndefined();
});
