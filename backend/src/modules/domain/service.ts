import { getMysqlPool } from '../../lib/mysql.js';
import { DomainRepository } from './repository.js';

let repositoryPromise: Promise<DomainRepository> | null = null;

const getRepository = async () => {
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const repository = new DomainRepository(getMysqlPool());
      await repository.initialize();
      return repository;
    })().catch((error) => {
      repositoryPromise = null;
      throw error;
    });
  }

  return repositoryPromise;
};

export const domainService = {
  async getMyClientAccount(userPublicId: string) {
    const repository = await getRepository();
    return repository.getMyClientAccount(userPublicId);
  },

  async listClientMatters(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientMatters(clientAccountId);
  },

  async getClientMatter(clientAccountId: number, matterPublicId: string) {
    const repository = await getRepository();
    return repository.getClientMatter(clientAccountId, matterPublicId);
  },

  async listClientDocuments(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientDocuments(clientAccountId);
  },

  async getClientDocument(clientAccountId: number, documentPublicId: string) {
    const repository = await getRepository();
    return repository.getClientDocument(clientAccountId, documentPublicId);
  },

  async listClientEvents(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientEvents(clientAccountId);
  },

  async listClientInvoices(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientInvoices(clientAccountId);
  },

  async getClientInvoice(clientAccountId: number, invoicePublicId: string) {
    const repository = await getRepository();
    return repository.getClientInvoice(clientAccountId, invoicePublicId);
  },

  async listClientPayments(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientPayments(clientAccountId);
  },

  async listClientRefunds(clientAccountId: number) {
    const repository = await getRepository();
    return repository.listClientRefunds(clientAccountId);
  },

  async assertCurrentClientAccountAccess(userPublicId: string, clientAccountId: number) {
    const repository = await getRepository();
    return repository.assertCurrentClientAccountAccess(userPublicId, clientAccountId);
  },
};
