import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import path from "path";

export class FreeStaticIpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new cdk.aws_ec2.Vpc(this, "Vpc", {
      natGateways: 0,
    });

    const sg = new cdk.aws_ec2.SecurityGroup(this, "SecurityGroup", { vpc });

    const func = new cdk.aws_lambda_nodejs.NodejsFunction(this, "TestFunc", {
      vpc,
      allowPublicSubnet: true,
      vpcSubnets: { subnets: vpc.publicSubnets },
      securityGroups: [sg],
      entry: path.join(__dirname, "./handler.ts"),
      handler: "handler",
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
    });

    vpc.publicSubnets.map((subnet) => {
      const cr = new cdk.custom_resources.AwsCustomResource(
        subnet,
        "customResource",
        {
          onUpdate: {
            physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
              // adds a dependency on the security group and the subnet
              `${sg.securityGroupId}-${subnet.subnetId}-CustomResource`
            ),
            service: "EC2",
            action: "describeNetworkInterfaces",
            parameters: {
              Filters: [
                { Name: "interface-type", Values: ["lambda"] },
                { Name: "group-id", Values: [sg.securityGroupId] },
                { Name: "subnet-id", Values: [subnet.subnetId] },
              ],
            },
          },
          policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
            resources:
              cdk.custom_resources.AwsCustomResourcePolicy.ANY_RESOURCE,
          }),
        }
      );
      // adds a dependency on the lambda function
      cr.node.addDependency(func);

      const eip = new cdk.aws_ec2.CfnEIP(subnet, "EIP", { domain: "vpc" });
      new cdk.aws_ec2.CfnEIPAssociation(subnet, "EIPAssociation", {
        networkInterfaceId: cr.getResponseField(
          "NetworkInterfaces.0.NetworkInterfaceId"
        ),
        allocationId: eip.attrAllocationId,
      });

      new cdk.CfnOutput(subnet, "ElasticIP", {
        value: eip.attrPublicIp,
      });
    });


    // prevent the lambda function from losing its ENI
    // If your lambda has side effects, make sure you early return when it's triggered by this rule
    new cdk.aws_events.Rule(this, "LambdaWeeklyTriggerRule", {
      schedule: cdk.aws_events.Schedule.cron({
        minute: "0",
        hour: "10",
        weekDay: "SUN,WED",
      }),
      targets: [new cdk.aws_events_targets.LambdaFunction(func)],
    });
  }
}
