import React from 'react';
import { CustomRow } from '@buffetjs/styles';
import { IconLinks } from '@buffetjs/core';
import PropTypes from 'prop-types';
import PrefixedIcon from '../PrefixedIcon';

const ListRow = ({ onClick, links, record }) => {
  return (
    <CustomRow onClick={onClick}>
      <td>{record.id}</td>
      <td>{record.project_id}</td>
      <td>{record.client_id}</td>
      <td>
        <IconLinks links={links} />
      </td>
    </CustomRow>
  );
};

ListRow.defaultProps = {
  children: null,
  onClick: () => {},
  links: [],
};

ListRow.propTypes = {
  record: PropTypes.any,
  links: PropTypes.array,
  onClick: PropTypes.func,
};

export default ListRow;
