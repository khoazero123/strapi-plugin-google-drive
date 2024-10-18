/*
 *
 * HomePage
 *
 */

import React, { memo, useRef, useEffect, useState } from 'react';
// import PropTypes from 'prop-types';
import { Header } from '@buffetjs/custom';
import { Table, Button, Padded, Select, Text, InputText } from '@buffetjs/core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Modal, ModalHeader, ModalFooter,
  useGlobalContext, request,
} from 'strapi-helper-plugin';

import pluginId from '../../pluginId';
import querystring from 'querystring';
import Container from '../../components/Container';

const HomePage = () => {
  const { formatMessage, plugins } = useGlobalContext();
  const [rows, setRows] = useState([]);
  const [currentRow, setCurrentRow] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  const [code, setCode] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const typeScopes = {
    upload: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    download: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive.readonly'],
  };
  const [scopeType, setScopeType] = useState(Object.keys(typeScopes)[0]);
  const isMounted = useRef(true);

  const pluginName = formatMessage({ id: `${pluginId}.plugin.name` });

  const fetchListData = async () => {
    setIsLoading(true);
    try {
      const data = await request(`/google-drive/clients`, {
        method: 'GET',
      });

      setRows(data);
    } catch (err) {
      strapi.notification.toggle({
        type: 'warning',
        message: { id: 'notification.error' },
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchListData();
    return () => {
      isMounted.current = false;
      setCode('');
    };
  }, []);

  const handleClickToggleModal = () => {
    setIsModalOpen(prev => !prev);
    setCurrentRow(null);
  };

  const handleClickConnect = async () => {
    setIsLoading(true);
    try {
      const data = await request(`/google-drive`, {
        method: 'POST',
        body: {
          ...currentRow,
          code
        },
      });
      handleClickToggleModal();
      strapi.notification.toggle({
        type: 'success',
        message: { id: 'notification.success.saved' },
      });
    } catch (err) {
      strapi.notification.toggle({
        type: 'warning',
        message: { id: 'notification.error' },
      });
    }
    setIsLoading(false);
  };

  const generateAuthUrl = ({ scopeType: _scopeType, ...client }) => {
    const SCOPES = typeScopes[_scopeType || scopeType];

    const _authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' + '?' + querystring.stringify({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: client.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob',
      scope: SCOPES.join(' '),
    });
    setAuthUrl(_authUrl);
    return _authUrl;
  };

  return (
    <Container>
      <Header {...{
        title: {
          label: pluginName,
        },
        content: 'Get google drive token for accounts',
        actions: [],
      }} isLoading={isLoading} />

      <Table
        className="table-wrapper"
        isLoading={isLoading}
        headers={[
          {
            name: 'ID',
            value: 'id',
          },
          {
            name: 'Project ID',
            value: 'project_id',
          },
          {
            name: 'Client ID',
            value: 'client_id',
          }
        ]}
        onClickRow={(e, data) => {
          setCurrentRow(data);
          generateAuthUrl(data);
          setIsModalOpen(true);
        }}
        rows={rows}
        rowLinks={[
          {
            icon: <FontAwesomeIcon icon='plug' />
          },
        ]}
      />

      <Modal withoverflow="true" onClosed={() => setIsModalOpen(false)} isOpen={isModalOpen} onToggle={handleClickToggleModal}>
        <ModalHeader headerBreadcrumbs={['Select scope to connect']}/>
        <Padded top left right bottom size="lg">
          <Select
            name="select"
            onChange={({ target: { value } }) => {
              setScopeType(value);
              generateAuthUrl({ ...currentRow, scopeType: value });
            }}
            options={Object.keys(typeScopes)}
            value={scopeType}
          />
        </Padded>
        {authUrl && (<Padded left right bottom size="lg">
          <Text>
            Click on <a href={authUrl} target="_blank">this link</a> to get redeem code. Then paste the code on input below.
          </Text>
        </Padded>)}
        <Padded left right bottom size="lg">
          <InputText
            name="input"
            onChange={({ target: { value } }) => {
              setCode(value);
            }}
            placeholder="redeem code"
            type="text"
            value={code}
          />
        </Padded>
        <ModalFooter>
          <section>
            <Button type="button" color="cancel" onClick={handleClickToggleModal}>
              Cancel
            </Button>

            <Button type="button" color="success" disabled={!code || isLoading} onClick={handleClickConnect}>
              Redeem
            </Button>
          </section>
        </ModalFooter>
      </Modal>

      <Padded bottom size="md" />
      <Padded bottom size="md" />
    </Container>
  );
};

export default memo(HomePage);
