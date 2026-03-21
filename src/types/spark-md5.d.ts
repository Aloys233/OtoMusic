declare module "spark-md5" {
  const SparkMD5: {
    hash(input: string, raw?: boolean): string;
  };

  export default SparkMD5;
}
