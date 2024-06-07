import { Signer, hexlify, toUtf8Bytes } from "../node_modules/ethers/lib.commonjs/index.js";
import { EthAddress, PropId, ProposalState, TokenId, VoteType } from "./common.js";
import { BreakoutResult, BurnRespectRequest, CustomCallRequest, CustomSignalRequest, NotImplemented, Proposal, ProposalMetadata, PutProposalFailure, RespectAccountRequest, RespectBreakoutRequest, TickRequest, TxFailed, VoteRequest, VoteWithProp, zVoteWithProp } from "./orclientTypes.js";
import { ORContext } from "./orContext.js";
import { NodeToClientTransformer } from "./transformers/nodeToClientTransformer.js";
import { ClientToNodeTransformer } from "./transformers/clientToNodeTransformer.js";
import { ProposalFull as NProp } from "./ornodeTypes.js";
import { sleep } from "./ts-utils.js";

export function isPropCreated(propState: ProposalState) {
  return propState.createTime > 0n;
}

export interface Config {
  /// How many onchain confirmations to wait for before considering proposal submitted
  propConfirms: number
}

/**
 * @notice When creating proposals this class first creates them onchain then tries to push them to ORNode (because ORNode won't accept them until they are submitted onchain).
 * This creates a risk that proposal is submitted onchain but fails to be submitted to ORNode.
 * For now the way we deal with it is that simply throw an exception with a ornode proposal we were trying to push.
 * The user of this class can then try doing {orclient}.context.ornode.putProposal(prop) again.
 * Worst case scenario is that some metadata about a proposal won't be visible in the frontend
 * because the creator of proposal failed to submit to ornode. That's not the worst thing that could happen - other users simply shouldn't vote for proposal if they lack details about it.
 * 
 */
export default class ORClient {
  private _ctx: ORContext;
  private _nodeToClient: NodeToClientTransformer;
  private _clientToNode: ClientToNodeTransformer;
  private _cfg: Config;

  constructor(context: ORContext, cfg: Config = { propConfirms: 3 }) {
    this._ctx = context;
    this._nodeToClient = new NodeToClientTransformer(this._ctx);
    this._clientToNode = new ClientToNodeTransformer(this._ctx);
    this._cfg = cfg;
  }

  connect(signer: Signer): ORClient {
    const newOrec = this._ctx.orec.connect(signer);
    const newCtx = new ORContext({
      ...this._ctx.config,
      orec: newOrec
    });
    return new ORClient(newCtx);
  }

  get context(): ORContext {
    return this._ctx;
  }

  // static async createORClient(config: Config): Promise<ORClient> {
  //   const client = new ORClient(config);
  //   return client;
  // }

  /**
   * Returns proposal by id
   * @param id - proposal id
   */
  async getProposal(id: PropId): Promise<Proposal> {
    const nprop = await this._ctx.ornode.getProposal(id);
    return this._nodeToClient.transformProp(nprop);
  }

  // UC8
  /**
   * Returns a list of proposals ordered from latest to oldest
   * @param from - Start of proposal range. 0 - last proposal, 1 - second to  last proposal and so on
   * @param count - Number of proposals to return
   */
  async lsProposals(from: number = 0, limit: number = 50): Promise<Proposal[]> {
    const nprops = await this._ctx.ornode.getProposals(from, limit);
    const props: Proposal[] = [];
    for (const nprop of nprops) {
      props.push(await this._nodeToClient.transformProp(nprop));
    }
    return props;
  }

  // UC2
  // TODO: Allow specifying text string instead of hexstring and convert it
  async vote(propId: PropId, vote: VoteType, memo?: string): Promise<void>;
  async vote(request: VoteRequest): Promise<void>;
  async vote(pidOrReq: VoteRequest | PropId, vote?: VoteType, memo?: string): Promise<void> {
    let req: VoteRequest;
    if (vote !== undefined && typeof pidOrReq === 'string') {
      req = { propId: pidOrReq, vote, memo }      
    } else {
      req = pidOrReq as VoteRequest;
    }
    const m = memo !== undefined ? hexlify(toUtf8Bytes(memo)) : "0x";
    const orec = this._ctx.orec;
    await orec.vote(req.propId, req.vote, m);
  }
  // UC3
  async execute(propId: PropId) {
    const orec = this._ctx.orec;
    const nprop = await this._ctx.ornode.getProposal(propId);
    if (nprop.content !== undefined) {
      await orec.execute(nprop.content);
    }
  }

  // UC{1,4}
  async submitBreakoutResult(
    request: RespectBreakoutRequest,
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformRespectBreakout(request);
    return await this._submitProposal(proposal, vote);
  }
  // UC5
  async proposeRespectTo(
    req: RespectAccountRequest,
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformRespectAccount(req);
    return await this._submitProposal(proposal, vote);
  }

  // UC6
  async burnRespect(
    req: BurnRespectRequest,
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformBurnRespect(req);
    return await this._submitProposal(proposal, vote);
  }

  async proposeCustomSignal(
    req: CustomSignalRequest,
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformCustomSignal(req);
    return await this._submitProposal(proposal, vote);
  }

  // UC7
  async proposeTick(
    req: TickRequest = {},
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformTick(req);
    return await this._submitProposal(proposal, vote);
  }

  async proposeCustomCall(
    req: CustomCallRequest,
    vote: VoteWithProp = { vote: VoteType.Yes }
  ): Promise<Proposal> {
    const proposal = await this._clientToNode.transformCustomCall(req);
    return await this._submitProposal(proposal, vote);
  }

  async getPeriodNum(): Promise<number> {
    return await this._ctx.ornode.getPeriodNum();
  }
  async getNextMeetingNum(): Promise<number> {
    return await this.getPeriodNum() + 1;
  }
  async getLastMeetingNum(): Promise<number> {
    return await this.getPeriodNum();
  }

  private async _submitProposal(proposal: NProp, vote?: VoteWithProp): Promise<Proposal> {
    await this._submitPropToChain(proposal, vote);
    await this._submitPropToOrnode(proposal);
    return await this._nodeToClient.transformProp(proposal);
  }

  private async _submitPropToOrnode(proposal: NProp) {
    try {
      await this._ctx.ornode.putProposal(proposal);
    } catch(err) {
      throw new PutProposalFailure(proposal, err);
    }
  }

  private async _submitPropToChain(proposal: NProp, vote?: VoteWithProp) {
    const resp = await this._submitPropTx(proposal, vote);
    // console.log(`Submitting proposal to chain: ${JSON.stringify(proposal)}`);
    const receipt = await resp.wait(this._cfg.propConfirms);
    if (receipt?.status !== 1) {
      throw new TxFailed(resp, receipt);
    }
  }

  private async _submitPropTx(proposal: NProp, vote?: VoteWithProp) {
    if (vote !== undefined && vote.vote !== VoteType.None) {
      return await this._ctx.orec.vote(
          proposal.id,
          vote.vote,
          vote.memo ?? "0x"
      );
    } else {
      return await this._ctx.orec.propose(proposal.id);
    }
  }

  // TODO: function to list respect NTTs
}