import * as cdk from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import {
  Cluster,
  ContainerImage,
  FargateTaskDefinition,
  LogDrivers,
} from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { Function } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { join } from "path";

interface CodeExecStackProps extends cdk.StackProps {
  readonly resultManagerLambda: Function;
  readonly questionBankTable: TableV2;
  readonly cluster: Cluster;
}
export class CodeExecStack extends cdk.Stack {
  public readonly taskDefinition: FargateTaskDefinition[] = [];
  public readonly fargateService: ApplicationLoadBalancedFargateService[] = [];
  public readonly languages: string[] = ["python", "javascript"];

  constructor(scope: Construct, id: string, props: CodeExecStackProps) {
    super(scope, id, props);

    // this.cluster = new Cluster(this, "ExecutorECSCluster");

    for (const language of this.languages) {
      const taskDefinition = new FargateTaskDefinition(
        this,
        `ECSFargateTaskDefinition${language}`,
        {
          cpu: 512,
          memoryLimitMiB: 1024,
        }
      );

      taskDefinition.addContainer(`ECSFargateContainer${language}`, {
        image: ContainerImage.fromAsset(join(__dirname, `executors`), {
          file: `Dockerfile.${language}`,
        }),
        logging: LogDrivers.awsLogs({
          streamPrefix: `ecs${language}`,
          logRetention: RetentionDays.ONE_DAY,
        }),
        portMappings: [{ containerPort: 80 }],
        environment: {
          LAMBDA_FUNCTION_NAME: props.resultManagerLambda.functionName,
          AWSREGION: this.region,
        },
      });

      props.resultManagerLambda.grantInvoke(taskDefinition.taskRole);
      props.questionBankTable.grantReadData(taskDefinition.taskRole);

      const fargateService = new ApplicationLoadBalancedFargateService(
        this,
        `ECSFargateServiceWithALB${language}`,
        {
          cluster: props.cluster,
          taskDefinition: taskDefinition,
          publicLoadBalancer: true,
          loadBalancerName: `ECSExecutorALB${language}`,
          desiredCount: 1,
        }
      );

      fargateService.service.autoScaleTaskCount({
        minCapacity: 1,
        maxCapacity: 6,
      });

      this.taskDefinition.push(taskDefinition);
      this.fargateService.push(fargateService);
    }
  }
}
