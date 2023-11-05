#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApigatewayAlbTestStack } from '../lib/apigateway-alb-test-stack';

const env = {
  account: '<account id>',
  region: 'ap-northeast-1',
  // account: process.env.CDK_DEFAULT_ACCOUNT,
  // region: process.env.CDK_DEFAULT_REGION
};

const app = new cdk.App();
new ApigatewayAlbTestStack(app, 'ApigatewayAlbTestStack', {
  apiRepositoryName: 'json-server',
  env,
});
