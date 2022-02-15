import {
  Connection,
  createConnection,
  Entity,
  EntityManager,
  getConnection,
  getManager,
  Repository,
} from 'typeorm';
import TransactionalTestContext from '../src/transactionalTestContext';
import Person from './entities/person.entity';

describe('transactional test example - SQL lite', () => {
  let connection: Connection;
  let repository: Repository<Person>;
  let transactionalContext: TransactionalTestContext;

  beforeAll(async () => {
    connection = await createConnection({
      type: 'sqlite',
      name: 'default',
      synchronize: true,
      dropSchema: true,
      entities: [Person],
      database: ':memory:',
    });
  });

  beforeEach(async () => {
    repository = connection.getRepository(Person);
    transactionalContext = new TransactionalTestContext(connection);
    await transactionalContext.start();
  });

  describe('rollback transaction', () => {
    beforeEach(async () => {
      await Promise.all([
        repository.save(new Person({ name: 'Aragorn' })),
        repository.save(new Person({ name: 'Legolas' })),
      ]);
    });

    it('the database should be empty', async () => {
      expect(await repository.count()).toEqual(2);
      await transactionalContext.finish();
      expect(await repository.count()).toEqual(0);
    });
  });

  describe('nested transaction', () => {
    it('does not error when it encounters a nested transaction', async () => {
      await getManager().transaction(async manager => {
        await manager.save(new Person({ name: 'Aragorn' }));
        await manager.save(new Person({ name: 'Legolas' }));
      });
      await transactionalContext.finish();
    });

    it('treats nested transaction as part of the test transaction', async () => {
      await expect(
        getManager().transaction(async manager => {
          await manager.save(new Person({ name: 'Gimli' }));
          throw new Error('this error triggers a rollback');
        }),
      ).rejects.toThrow('this error triggers a rollback');
      expect(await repository.count()).toEqual(1);
      await transactionalContext.finish();
    });

    it('resets EntityManager.prototype.transaction() after context ends', async () => {
      await transactionalContext.finish();
      await expect(
        getManager().transaction(async manager => {
          await manager.save(new Person({ name: 'Pippin' }));
          throw new Error('this error triggers a rollback');
        }),
      ).rejects.toThrow('this error triggers a rollback');
      expect(await repository.count()).toEqual(0);
    });
  });
});
