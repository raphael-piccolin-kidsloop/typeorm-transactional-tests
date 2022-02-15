import { Connection, EntityManager, getManager } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { QueryRunnerWrapper, wrap } from './queryRunnerWrapper';

export default class TransactionalTestContext {
  private queryRunner: QueryRunnerWrapper | null = null;
  private originQueryRunnerFunction: any;
  private originTransactionFunction: any;

  constructor(private readonly connection: Connection) {}

  async start(): Promise<void> {
    if (this.queryRunner) {
      throw new Error('Context already started');
    }
    try {
      this.queryRunner = this.buildWrappedQueryRunner();
      this.monkeyPatchQueryRunnerCreation(this.queryRunner);
      this.monkeyPatchManagerTransaction(this.queryRunner);
      await this.queryRunner.connect();
      await this.queryRunner.startTransaction();
    } catch (error) {
      await this.cleanUpResources();
      throw error;
    }
  }

  async finish(): Promise<void> {
    if (!this.queryRunner) {
      throw new Error('Context not started. You must call "start" before finishing it.');
    }
    try {
      await this.queryRunner.rollbackTransaction();
    } finally {
      await this.cleanUpResources();
    }
  }

  private buildWrappedQueryRunner(): QueryRunnerWrapper {
    const queryRunner = this.connection.createQueryRunner();
    return wrap(queryRunner);
  }

  private monkeyPatchQueryRunnerCreation(queryRunner: QueryRunnerWrapper): void {
    this.originQueryRunnerFunction = Connection.prototype.createQueryRunner;
    Connection.prototype.createQueryRunner = () => queryRunner;
  }

  private monkeyPatchManagerTransaction(queryRunner: QueryRunnerWrapper): void {
    this.originTransactionFunction = EntityManager.prototype.transaction;
    EntityManager.prototype.transaction = this.transactionBypass(queryRunner);
  }

  private transactionBypass(queryRunner: QueryRunnerWrapper) {
    return <T>(
      isolationOrRunInTransaction: IsolationLevel | ((entityManager: EntityManager) => Promise<T>),
      runInTransactionParam?: (entityManager: EntityManager) => Promise<T>,
    ): Promise<T> => {
      const runInTransaction =
        typeof isolationOrRunInTransaction === 'function'
          ? isolationOrRunInTransaction
          : runInTransactionParam;
      if (!runInTransaction) {
        throw new Error(
          `Transaction method requires callback in second parameter if isolation level is supplied.`,
        );
      }
      return runInTransaction(queryRunner.manager);
    };
  }

  private restoreQueryRunnerCreation(): void {
    if (this.originQueryRunnerFunction) {
      Connection.prototype.createQueryRunner = this.originQueryRunnerFunction;
    }
  }

  private restoreManagerTransaction(): void {
    if (this.originTransactionFunction) {
      EntityManager.prototype.transaction = this.originTransactionFunction;
    }
  }

  private async cleanUpResources(): Promise<void> {
    this.restoreQueryRunnerCreation();
    this.restoreManagerTransaction();
    if (this.queryRunner) {
      await this.queryRunner.releaseQueryRunner();
      this.queryRunner = null;
    }
  }
}
