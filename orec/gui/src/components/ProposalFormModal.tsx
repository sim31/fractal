import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Select,
} from '@chakra-ui/react'
import { ChangeEvent, useState } from 'react';
import MintRespectForm from './MintRespectForm';
import BurnRespectForm from './BurnRespectForm';

export type ProposalFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProposalFormModal(props: ProposalFormModalProps) {
  const [msgType, setMsgType] = useState('none');

  const onMsgTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setMsgType(event.target.value);
  }

  const renderForm = () => {
    if (msgType === "mint") {
      return <MintRespectForm/>
    } else if (msgType === "burn") {
      return <BurnRespectForm/>
    } else {
      return <></>
    }
  }

  return (
    <Modal size="3xl" isOpen={props.isOpen} onClose={props.onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="2xl">
          New Proposal
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Select placeholder='Select Action' onChange={onMsgTypeChange} value={msgType}>
            <option value='mint'>Mint Respect</option>
            <option value='burn'>Burn Respect</option>
          </Select>

          {renderForm()}

        </ModalBody>

        <ModalFooter>
          <Button mr={3}>Propose</Button>
          <Button colorScheme='blue' mr={3} onClick={props.onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}