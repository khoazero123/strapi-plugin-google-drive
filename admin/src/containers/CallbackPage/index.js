
import React, { useEffect, useState } from "react";

export default function OAuthCallback() {
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setError('No code found');
      return;
    }

    if (window.opener) {
      window.opener.postMessage(
        { type: "OAUTH_SUCCESS", code: code },
        `${window.location.origin}/admin/plugins/google-drive`
      );
      window.close();
    } else {
      setError('No window.opener found');
    }
  }, []);

  return <p>{error || 'Processing login...'}</p>;
}
