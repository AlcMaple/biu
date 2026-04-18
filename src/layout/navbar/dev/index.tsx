import { useEffect, useState } from "react";

import { RiCodeLine } from "@remixicon/react";

import IconButton from "@/components/icon-button";
import platform from "@/platform";

const Dev = () => {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    platform.isDev().then(setIsDev);
  }, []);

  if (!isDev) {
    return null;
  }

  return (
    <IconButton onPress={platform.toggleDevTools}>
      <RiCodeLine size={18} />
    </IconButton>
  );
};

export default Dev;
