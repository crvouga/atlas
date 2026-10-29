/** A store on the fake S3 of `fake-s3.ts`, kept apart so scripts that only need the fake server do not pull in the S3 store. */
import { s3Store, type S3Store } from '../../reports/src/s3-store';
import { S3_TEST_ENV, type fakeS3 } from './fake-s3';

/** A store on a fake S3, signed in with the test credentials: for seeding a bucket and looking inside it. */
export function storeOn(fake: ReturnType<typeof fakeS3>, prefix = ''): S3Store {
  return s3Store({ bucket: fake.bucket, prefix, region: 'us-east-1', endpoint: 'http://s3.test', forcePathStyle: true, credentials: { accessKeyId: S3_TEST_ENV.ATLAS_S3_ACCESS_KEY_ID, secretAccessKey: S3_TEST_ENV.ATLAS_S3_SECRET_ACCESS_KEY }, env: {}, fetch: fake.fetch });
}

