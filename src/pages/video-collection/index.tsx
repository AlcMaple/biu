import React, { useMemo } from "react";
import { useParams, useSearchParams } from "react-router";

import { CollectionType } from "@/common/constants/collection";

import VideoCollections from "./collections";
import Favorites from "./favorites";
import LocalFavorites from "./local-favorites";
import Series from "./series";

const Folder = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const isLocalFolder = Number(id) < 0;

  const collectionType = useMemo(
    () => Number(searchParams.get("type") || CollectionType.Favorite) as CollectionType,
    [searchParams],
  );

  if (isLocalFolder) {
    return <LocalFavorites />;
  }

  return (
    <>
      {collectionType === CollectionType.Favorite && <Favorites />}
      {collectionType === CollectionType.VideoCollections && <VideoCollections />}
      {collectionType === CollectionType.VideoSeries && <Series />}
    </>
  );
};

export default Folder;
