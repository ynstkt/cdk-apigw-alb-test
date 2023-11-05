# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template


## Operation Commands

- プロジェクト作成（実施済）
```bash
mkdir apigateway-alb-test
cd apigateway-alb-test
cdk init app --language typescript
```

- ECSサービス用dockerイメージ作成（本リポジトリには含まないが、備忘としてコマンドだけ記載）
```bash
docker build -t json-server ./json-server
docker run --rm -p 3000:3000 json-server
```

- ECR登録（実施済、事前にECRに"json-server"というリポジトリを作成済の前提）
```bash
export ACCOUNT_ID=<account id>
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com
docker tag json-server:latest ${ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/json-server:latest
docker push ${ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/json-server:latest
```

- AWSデプロイ
```bash
npm run build && cdk deploy
cdk destroy
```

- 踏み台EC2からのALB疎通確認（SessionManagerから）
```bash
curl <ALBのDNS名>:3000/internal
[
  {
    "id": 1,
    "hoge": "internal"
  }
]

curl <ALBのDNS名>:3000/external
[
  {
    "id": 1,
    "hoge": "external"
  }
]
```

- APIGateway疎通確認（APIGatewayをprivateにした場合は踏み台EC2から）
```bash
export URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/
curl ${URL}external/
curl -X POST -H "Content-Type: application/json" -d '{"hoge" : "hogehoge"}' ${URL}external/
curl ${URL}external/
curl -X PUT -H "Content-Type: application/json" -d '{"hoge" : "hoge2"}' ${URL}external/2
curl ${URL}external/
curl -X DELETE ${URL}external/2
curl ${URL}external/
```
