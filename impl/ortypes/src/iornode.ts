import { stringify } from "ts-utils";
import { PropId } from "./orec.js";
import { ErrorType, ORNodePropStatus, Proposal, ProposalFull, zErrorType } from "./ornode.js";

export interface IORNode {
  /**
   * Upload a content of a proposal, which is already created onchain.
   * 
   * ORNode checks if proposal with same id was created onchain, otherwise it throws ProposalNotCreated.
   * 
   */
  putProposal: (proposal: ProposalFull) => Promise<ORNodePropStatus>;
  /**
   * Should return only proposals which have been submitted onchain
   */
  getProposal: (id: PropId) => Promise<Proposal>;
  getProposals: (from: number, limit: number) => Promise<Proposal[]>

  getPeriodNum: () => Promise<number>;

}

export class ProposalNotFound extends Error {
  name: ErrorType = zErrorType.enum.ProposalNotFound;

  constructor(propId: PropId) {
    const msg = `Proposal with id ${propId} does not exist`;
    super(msg);
  }
}

export class ProposalNotCreated extends Error {
  name: ErrorType = zErrorType.enum.ProposalNotCreated;
  constructor(proposal: Proposal) {
    const msg = `Proposal with id ${proposal.id} has not been created onchain yet. Proposal: ${stringify(proposal)}`;
    super(msg);
  }
}

export class ProposalInvalid extends Error {
  name: ErrorType = zErrorType.enum.ProposalNotCreated;
  cause: string;

  constructor(proposal: Proposal, cause: any) {
    const msg = `Proposal invalid. Proposal: ${stringify(proposal)}`;
    super(msg);
    this.cause = cause;
  } 
}
