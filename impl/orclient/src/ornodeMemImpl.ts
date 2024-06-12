import { expect } from "chai";
import {
  EthAddress,
  OrecContract,
  Respect1155,
  ORContext,
  IORNode,
  PropId,
  isEthAddr,
  OrecFactory,
  FractalRespect,
  zSignalType,
  zTickSignalType,
  ProposalInvalid,
  ProposalNotCreated,
  ProposalNotFound
} from "ortypes"
import { ORNodePropStatus, Proposal, ProposalFull, ProposalValid, zORNodePropStatus, zProposal, zProposalValid } from "ortypes/dist/ornode.js";
import { SafeRecord } from "ts-utils";
import { z } from "zod";

export interface ConstructorConfig {
  /**
   * For how long a proposal without weighted votes will be stored
   * @default: orec.votePeriod
   */
  weghtlessPropAliveness?: number
}

export interface Config extends ConstructorConfig{
  newRespect: EthAddress | Respect1155.Contract,
  orec: EthAddress | OrecContract
}

type ORNodeContextConfig = Omit<ORContext.Config, "ornode">;

/**
 * TODO: Currently this class only saves proposals which are created onchain after
 * it starts running. This means that it will miss any proposals that happened before
 * ORNode was launched.
 * TODO: Should save proposals to storage so that ORNode could be restarted
 * TODO: Would be good to have a method to delete proposals which dot get any
 * weighted votes during voteTime, to save resources against spam.
 * TODO: Function to get signal data
 */
export class ORNodeMemImpl implements IORNode {
  // value might be null if proposal has been submitted onchain but not to us
  private _propMap: SafeRecord<PropId, Proposal> = {}
  private _propIndex: PropId[] = [];
  private _periodNum: number = 0;
  private _ctx: ORContext.ORContext;
  private _cfg: ConstructorConfig;

  private constructor(contextCfg: ORNodeContextConfig, config: ConstructorConfig) {
    this._ctx = new ORContext.ORContext({ ...contextCfg, ornode: this });
    this._cfg = config;
  }

  static async createORNodeMemImpl(config: Config): Promise<IORNode> {
    const orec: OrecContract = isEthAddr(config.orec)
      ? OrecFactory.connect(config.orec)
      : config.orec;
    const newRespect = isEthAddr(config.newRespect)
      ? Respect1155.Factory.connect(config.newRespect)
      : config.newRespect;
    const oldRespectAddr = await orec.respectContract();
    const oldRespect: FractalRespect.Contract = FractalRespect.Factory.connect(oldRespectAddr);

    const ctx: ORNodeContextConfig = {
      orec, newRespect, oldRespect
    };

    const propAliveness = config.weghtlessPropAliveness ?? Number(await orec.voteLen());

    const cfg: ConstructorConfig = {
      weghtlessPropAliveness: propAliveness
    }

    const ornode = new ORNodeMemImpl(ctx, cfg);

    orec.on(orec.getEvent("ProposalCreated"), (propId) => {
      ornode._storeNewProposal(propId);
    });

    orec.on(orec.getEvent("Signal"), (signalType, data) => {
      const st = zSignalType.parse(signalType);
      if (st === zTickSignalType.value) {
        ornode._onTickSignal(data);
      } else {
        ornode._onSignal(st, data);
      }
    });

    return ornode
  }

  private _storeNewProposal(propId: PropId) {
    expect(this._propMap[propId]).to.be.undefined;
    this._propMap[propId] = { id: propId };
    this._propIndex.push(propId);
    // console.log(`Storing new proposal ${propId}. Index: ${this._propIndex.length - 1}`);
  }

  private _onTickSignal(data: string) {
    this._periodNum += 1;
    console.log(`Tick. Data: ${data}`);
  }

  private _onSignal(signalType: number, data: string) {
    console.log(`Signal! Type: ${signalType}, data: ${data}`);
  }

  async putProposal(proposal: ProposalFull): Promise<ORNodePropStatus> {
    let propValid: ProposalValid;
    try {
      propValid = zProposalValid.parse(proposal);
    } catch (err) {
      throw new ProposalInvalid(proposal, err);
    }

    const exProp = this._propMap[proposal.id];
    if (exProp === undefined) {
      throw new ProposalNotCreated(proposal);
    }
    expect(exProp.id).to.be.equal(proposal.id);

    if (exProp.content !== undefined) {
      zProposalValid.parse(exProp);
      // If both proposals are valid and their id member is the same it means that proposals are equal
      // Return status saying that proposal already exists.
      return zORNodePropStatus.Enum.ProposalExists;
    } else {
      this._propMap[proposal.id] = propValid;
      return zORNodePropStatus.Enum.ProposalStored;
    }
  } 

  async getProposal(id: PropId): Promise<Proposal> {
    const val = this._propMap[id];
    if (val === undefined) {
      // TODO: check if proposal is created onchain. If so then return Proposal with unknown fields as undefined
      throw new ProposalNotFound(id);
    } else {
      z.literal(id).parse(val.id);
      return val;
    }
  }

  async getProposals(from: number, limit: number): Promise<Proposal[]> {
    const f = z.number().gte(0).lt(this._propIndex.length).parse(from);
    const l = z.number().gt(0).parse(limit);
    const firstIndex = this._propIndex.length - 1 - f;
    const lastIndex = firstIndex - limit >= 0
      ? firstIndex - limit
      : 0;
    
    const proposals = new Array<Proposal>();
    for (let i = firstIndex; i >= lastIndex; i--) {
      // Checks if proposal is stored
      const propId = this._propIndex[i];
      const prop = zProposal.parse(this._propMap[propId]);
      proposals.push(prop);
    }

    return proposals;
  }

  // TODO:
  async getPeriodNum(): Promise<number> {
    return this._periodNum;
  }

}