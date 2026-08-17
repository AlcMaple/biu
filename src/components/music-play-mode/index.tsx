import { getPlayModeList } from "@/common/constants/audio";
import IconButton from "@/components/icon-button";
import { usePlayList } from "@/store/play-list";

const PlayModeList = getPlayModeList(18);

const MusicPlayMode = () => {
  const playMode = usePlayList(s => s.playMode);
  const togglePlayMode = usePlayList(s => s.togglePlayMode);
  const currentMode = PlayModeList.find(item => item.value === playMode);

  return (
    <IconButton
      className="flex-none"
      tooltip={currentMode?.desc}
      aria-label={currentMode?.desc ?? "播放模式"}
      onPress={togglePlayMode}
    >
      {currentMode?.icon}
    </IconButton>
  );
};

export default MusicPlayMode;
