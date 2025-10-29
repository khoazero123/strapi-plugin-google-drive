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
  const [isOauthSuccess, setIsOauthSuccess] = useState(false);
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

  const handleClickConnect = async (_code) => {
    setIsLoading(true);
    try {
      const data = await request(`/google-drive`, {
        method: 'POST',
        body: {
          ...currentRow,
          code: _code || code,
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
    const state = {
      clientId: client.id,
    };
    const stateBase64 = Buffer.from(JSON.stringify(state)).toString('base64');
    const _authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' + '?' + querystring.stringify({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: client.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob',
      state: stateBase64,
      scope: SCOPES.join(' '),
    });
    setAuthUrl(_authUrl);
    return _authUrl;
  };

  const handleLoginWithGoogle = () => {
    const authWindow = window.open(authUrl);

    // Lắng nghe message từ tab con
    window.addEventListener("message", (event) => {
      // Kiểm tra nguồn (bảo mật)
      // if (event.origin !== "http://localhost:1337") return;
      const { data } = event;
      if (data?.type === "OAUTH_SUCCESS") {
        console.log("data", data);
        console.log("Token nhận được:", data.code);
        setCode(data.code);
        handleClickConnect(data.code);
        setIsOauthSuccess(true);
      }
    });
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
        {!isOauthSuccess && authUrl && (<Padded left right bottom size="lg">
          <Text>
            <button onClick={handleLoginWithGoogle} style={{ backgroundColor: 'blue', color: 'white', padding: '10px 20px', borderRadius: '5px' }}>Login with Google</button>
          </Text>
        </Padded>)}
        {isOauthSuccess && (<Padded left right bottom size="lg">
          <Text>
            <span>Oauth success, you can close this modal and start <a href="/admin/plugins/drive-import">import</a> files from Google Drive</span>
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
            disabled={isOauthSuccess}
          />
        </Padded>
        <ModalFooter>
          <section>
            <Button type="button" color="cancel" onClick={handleClickToggleModal}>
              Cancel
            </Button>

            {!isOauthSuccess && (
              <Button type="button" color="success" disabled={!code || isLoading} onClick={handleClickConnect}>
                Redeem
              </Button>
            )}
            {isOauthSuccess && (
              <Button type="button" color="success" disabled={isLoading} onClick={handleClickToggleModal}>
                Close
              </Button>
            )}
          </section>
        </ModalFooter>
      </Modal>

      <Padded bottom size="md" />
      <Padded bottom size="md" />
    </Container>
  );
};

export default memo(HomePage);
