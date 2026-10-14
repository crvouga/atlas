import { expect, test } from 'bun:test';

import { presignUrl, sha256Hex, signRequest, uriEncode } from '../src/sigv4';

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

test("AWS's published example signs to AWS's published signature", async () => {
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
  const headers = await signRequest({
    method: 'GET',
    url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', 'x-amz-date': '20150830T123600Z' },
    payloadHash: await sha256Hex(''),
    credentials, region: 'us-east-1', service: 'iam',
    at: new Date('2015-08-30T12:36:00Z'),
    doubleEncodePath: true
  });
  expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
});

test("AWS's published S3 GET example signs to AWS's published signature", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (GET Object with a Range)
  const s3 = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const headers = await signRequest({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    credentials: s3, region: 'us-east-1', service: 's3',
    at: new Date('2013-05-24T00:00:00Z')
  });
  expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test("AWS's published presigned URL example signs to AWS's published signature", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const s3 = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const url = await presignUrl({ url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), credentials: s3, region: 'us-east-1', service: 's3', at: new Date('2013-05-24T00:00:00Z'), expiresSeconds: 86400 });
  expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('keys are encoded the way SigV4 asks, so unusual keys sign and read back', () => {
  expect(uriEncode('a b/c+d~e_f-g.h')).toBe('a%20b%2Fc%2Bd~e_f-g.h');
  expect(uriEncode('a b/c', true)).toBe('a%20b/c');
  expect(uriEncode('é')).toBe('%C3%A9');
});
