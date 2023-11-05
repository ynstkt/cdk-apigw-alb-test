import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnIntegration, CfnRoute } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpApi } from '@aws-cdk/aws-apigatewayv2-alpha';

interface ApigatewayAlbTestStackProps extends cdk.StackProps {
  apiRepositoryName: string;
}

export class ApigatewayAlbTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApigatewayAlbTestStackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new cdk.aws_ec2.Vpc(this, 'Vpc', {
      subnetConfiguration: [
        {
          name: 'isolated',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      createInternetGateway: false,
      maxAzs: 2,
      natGateways: 0,
    });

    const privateSubnets = vpc.selectSubnets({
      subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnets;

    const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
    });

    const ecsSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
    });

    const albClientSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'AlbClientSecurityGroup', {
      vpc,
    });

    albSecurityGroup.addIngressRule(
      albClientSecurityGroup,
      cdk.aws_ec2.Port.tcp(3000),
      'allow 3000 from Client'
    );
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      cdk.aws_ec2.Port.tcp(3000),
      'allow 3000 from ALB'
    );

    
    // ECS
    // private subnetからのECR接続用VPCエンドポイント
    vpc.addInterfaceEndpoint("ecr-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR
    });
    vpc.addInterfaceEndpoint("ecr-dkr-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER
    });
    vpc.addGatewayEndpoint("S3EndpointForIsolatedSubnet", {
      service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
    });

    // private subnetからのCloudWatchLogs接続用VPCエンドポイント
    vpc.addInterfaceEndpoint("logs-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS
    });
    
    const cluster = new cdk.aws_ecs.Cluster(this, 'EcsCluster', {
      vpc,
      enableFargateCapacityProviders: true,
    });

    // タスク実行ロールにECRアクセス権限を追加
    const taskExecutionRole = new cdk.aws_iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });

    const fargateTaskDefinition = new cdk.aws_ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
    });

    const apiRepo = cdk.aws_ecr.Repository.fromRepositoryName(this, 'ApiRepository', props.apiRepositoryName);
    const apiContainerDefinition = fargateTaskDefinition.addContainer('ApiContainer', {
      containerName: 'api',
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(apiRepo),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({ streamPrefix: 'ecs' }),
      portMappings: [
        {
          containerPort: 3000,
          hostPort: 3000,
        },
      ],
    });

    fargateTaskDefinition.defaultContainer = apiContainerDefinition;

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: false,
      securityGroup: albSecurityGroup,
    });

    const service = new cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'Service',
      {
        cluster,
        taskDefinition: fargateTaskDefinition,
        taskSubnets: {
          subnets: privateSubnets,
        },
        listenerPort: 3000,
        loadBalancer: alb,
        openListener: false,
        securityGroups: [
          ecsSecurityGroup,
        ],
      }
    );


    // Bastion
    // SessionManager接続用VPCエンドポイント
    vpc.addInterfaceEndpoint("ssm-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SSM
    });
    vpc.addInterfaceEndpoint("ssm-messages-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES
    });
    vpc.addInterfaceEndpoint("ec2-messages-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES
    });

    // private subnetからのSessionManager接続用ロール
    const instanceRole = new cdk.aws_iam.Role(this, 'BastionRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // VPC内からのALB疎通用EC2
    const bastion = new cdk.aws_ec2.Instance(this, 'Bastion', {
      vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED
      }),
      instanceType: new cdk.aws_ec2.InstanceType(this.node.tryGetContext('instanceType')),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: albClientSecurityGroup,
      role: instanceRole,
    });


    // HTTP API
    const httpVpcLink = new cdk.aws_apigatewayv2.CfnVpcLink(this, 'HttpVpcLink', {
      name: 'private-alb-test',
      subnetIds: privateSubnets.map((subnet: cdk.aws_ec2.ISubnet) => subnet.subnetId),
      securityGroupIds: [albClientSecurityGroup.securityGroupId],
    });

    const httpExternalApi = new HttpApi(this, 'HttpExternalApi');

    const httpExternalApiAlbIntegration = new CfnIntegration(this, 'HttpExternalApiALBIntegration', {
      apiId: httpExternalApi.httpApiId,
      connectionId: httpVpcLink.ref,
      connectionType: 'VPC_LINK',
      integrationMethod: 'ANY',
      integrationType: 'HTTP_PROXY',
      integrationUri: alb.listeners[0].listenerArn,
      payloadFormatVersion: "1.0",
    });

    new CfnRoute(this, 'HttpExternalRoute', {
      apiId: httpExternalApi.httpApiId,
      routeKey: 'ANY /external/{proxy+}',
      target: `integrations/${httpExternalApiAlbIntegration.ref}`,
    });      

    // private API Gateway用VPCエンドポイント
    const apiGatewayVpcEndpointSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, "ApiGatewayVpcEndpointSecurityGroup", {
      vpc,
    });
    apiGatewayVpcEndpointSecurityGroup.addIngressRule(
      albClientSecurityGroup,
      cdk.aws_ec2.Port.tcp(80),
      'allow 80 from bastion'
    );
    apiGatewayVpcEndpointSecurityGroup.addIngressRule(
      albClientSecurityGroup,
      cdk.aws_ec2.Port.tcp(443),
      'allow 443 from bastion'
    );    
    const privateApiVpcEndpoint = vpc.addInterfaceEndpoint("apigateway-endpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
      securityGroups: [apiGatewayVpcEndpointSecurityGroup],
      open: false,
    });


    // REST API
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, 'NLB', {
      vpc,
    });
    const nlbSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'NlbSecurityGroup', {
      vpc,
    });
    nlbSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.tcp(3000),
      'allow 3000 from Any'
    );
    const cfnLoadBalancer = nlb.node.defaultChild as cdk.aws_elasticloadbalancingv2.CfnLoadBalancer;
    cfnLoadBalancer.addPropertyOverride('SecurityGroups', [
      nlbSecurityGroup.securityGroupId,
      albClientSecurityGroup.securityGroupId,
    ]);

    const nlbListener = nlb.addListener("NlbHttpListener", {
      port: 3000,
      protocol: cdk.aws_elasticloadbalancingv2.Protocol.TCP
    });
    nlbListener.addTargets("AlbTarget", {
      targets: [ new cdk.aws_elasticloadbalancingv2_targets.AlbTarget(alb, 3000) ],
      port: 3000
    });

    const restVpcLink = new cdk.aws_apigateway.VpcLink(this, 'RestVpcLink', {
      targets: [nlb],
    });
    
    // public
    // const restExternalApi = new cdk.aws_apigateway.RestApi(this, 'RestExternalApi');
    // private
    const restExternalApi = new cdk.aws_apigateway.RestApi(this, 'PrivateRestExternalApi', {
      endpointTypes: [cdk.aws_apigateway.EndpointType.PRIVATE],
      policy: new cdk.aws_iam.PolicyDocument({
        statements: [
          new cdk.aws_iam.PolicyStatement({
            principals: [new cdk.aws_iam.AnyPrincipal],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
            effect: cdk.aws_iam.Effect.DENY,
            conditions: {
              StringNotEquals: {
                "aws:SourceVpce": privateApiVpcEndpoint.vpcEndpointId
              }
            }
          }),
          new cdk.aws_iam.PolicyStatement({
            principals: [new cdk.aws_iam.AnyPrincipal],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
            effect: cdk.aws_iam.Effect.ALLOW
          }),
        ]
      }),
    });

    const integrationPropertiesBase = {
      type: cdk.aws_apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
    };
    const integratoinOptionsBase = {
      connectionType: cdk.aws_apigateway.ConnectionType.VPC_LINK,
      vpcLink: restVpcLink,
    }
    const uriBase = `http://${nlb.loadBalancerDnsName}:3000/external/`;

    const routeIntegration = new cdk.aws_apigateway.Integration({
      ...integrationPropertiesBase,
      options: integratoinOptionsBase,
      uri: uriBase,
    });

    const proxyIntegration = new cdk.aws_apigateway.Integration({
      ...integrationPropertiesBase,
      options: {
        ...integratoinOptionsBase,
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy',
        },
      },
      uri: `${uriBase}{proxy}`,
    });

    const externalRoute = restExternalApi.root.addResource('external');
    externalRoute.addMethod('ANY', routeIntegration);
    externalRoute.addProxy({
      defaultIntegration: proxyIntegration,
      defaultMethodOptions: {
        requestParameters: {
          'method.request.path.proxy': true,
        },
      },
    });
  };
}

