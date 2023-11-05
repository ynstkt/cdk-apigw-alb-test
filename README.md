# Internal な ALB/ECS の一部のパスだけ API Gateway で公開するCDKサンプルコード

// TODO: 図にする

- public な API Gateway の場合
  - API Gateway(HTTP API) -> VPC Link -> [ Internal ALB -> ECS Service ]
  - API Gateway(REST API) -> VPC Link -> [ Internal NLB -> Internal ALB -> ECS Service ]

- private な API Gateway の場合
  - [ EC2 at private subnet -> VPC Endpoint ] -> API Gateway(REST API) -> VPC Link -> [ Internal NLB -> Internal ALB -> ECS Service ]
  - ※ HTTP API は private にできない

## Operation Commands

- CDKプロジェクト作成（実施済）
```bash
mkdir apigateway-alb-test
cd apigateway-alb-test
cdk init app --language typescript
```

- ECSサービス用dockerイメージ作成（関連コードは本リポジトリには含まないが、備忘としてコマンドだけ記載）
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
