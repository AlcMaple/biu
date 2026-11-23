import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { RiStarFill, RiStarLine } from "@remixicon/react";

import { isOfflineDemo } from "@/common/offline-demo";
import { toPlaybackFavoriteModalData } from "@/common/utils/fav";
import IconButton from "@/components/icon-button";
import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useModalStore } from "@/store/modal";
import { useMusicFavStore } from "@/store/music-fav";
import { usePlaylistSession } from "@/store/playlist-session";
import { usePlayList } from "@/store/play-list";

const MusicFavButton = () => {
  const session = usePlaylistSession();
  const location = useLocation();
  const navigate = useNavigate();
  const list = usePlayList(s => s.list);
  const playId = usePlayList(s => s.playId);
  const playItem = useMemo(() => list.find(item => item.id === playId), [list, playId]);
  const onOpenFavSelectModal = useModalStore(s => s.onOpenFavSelectModal);
  const isFav = useMusicFavStore(s => s.isFav);
  const refreshIsFav = useMusicFavStore(s => s.refreshIsFav);
  const setIsFav = useMusicFavStore(s => s.setIsFav);

  useEffect(() => {
    if (!session.ready && !isOfflineDemo) {
      useMusicFavStore.setState({ isFav: false, isThumb: false });
      return;
    }
    void refreshIsFav();
  }, [playItem, session, refreshIsFav]);

  const handleOpen = () => {
    if (!playItem) return;
    const localItems = useFavoritesStore
      .getState()
      .createdFavorites.filter(folder => folder.isLocal)
      .flatMap(folder => useLocalFavItemsStore.getState().folderItems[folder.id] ?? []);
    const modalData = toPlaybackFavoriteModalData(playItem, localItems);
    if (!modalData) return;
    onOpenFavSelectModal({
      ...modalData,
      onSuccess: selectedIds => {
        setIsFav(Boolean(selectedIds?.length));

        if (location.pathname.startsWith("/collection/")) {
          const searchParams = new URLSearchParams(location.search);
          searchParams.set("refresh", Date.now().toString());

          navigate(
            {
              pathname: location.pathname,
              search: `?${searchParams.toString()}`,
            },
            {
              replace: true,
            },
          );
        }
      },
    });
  };

  return (
    <IconButton onPress={handleOpen}>
      {isFav ? <RiStarFill size={18} className="text-primary" /> : <RiStarLine size={18} />}
    </IconButton>
  );
};

export default MusicFavButton;
