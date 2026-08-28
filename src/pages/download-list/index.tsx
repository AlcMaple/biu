import { useEffect, useState } from "react";

import {
  Button,
  Card,
  CardBody,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  Radio,
  RadioGroup,
  TableRow,
} from "@heroui/react";
import { RiDeleteBinLine, RiExternalLinkLine, RiFolderLine } from "@remixicon/react";
import { filesize } from "filesize";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { formatMillisecond } from "@/common/utils/time";
import { openBiliVideoLink } from "@/common/utils/url";
import Empty from "@/components/empty";
import Image from "@/components/image";
import PlatformTooltip from "@/components/platform-tooltip";
import ScrollContainer from "@/components/scroll-container";
import platform from "@/platform";
import { useSettings } from "@/store/settings";

import DownloadActions from "./actions";
import DownloadProgress from "./progress";

const MobileDownloadItem = ({ item, quality }: { item: MediaDownloadTask; quality: string }) => (
  <div className="border-divider/50 rounded-medium flex min-w-0 flex-col gap-3 border p-3">
    <div className="flex min-w-0 items-center gap-3">
      <Image radius="md" src={item.cover} width={56} height={56} className="flex-none object-cover" />
      <div className="min-w-0 flex-1">
        <div
          className="flex min-w-0 cursor-pointer items-center gap-1"
          onClick={() =>
            openBiliVideoLink({
              type: item.sid ? "audio" : "mv",
              bvid: item.bvid,
              sid: item.sid,
            })
          }
        >
          <span className="line-clamp-2 min-w-0 text-sm font-medium">{item.title}</span>
          <RiExternalLinkLine className="flex-none" size={14} />
        </div>
        {Boolean(quality) && (
          <Chip size="sm" radius="sm" variant="flat" className="mt-1">
            {quality}
          </Chip>
        )}
      </div>
    </div>
    <DownloadProgress data={item} />
    <div className="text-foreground-500 flex items-center justify-between gap-2 text-xs">
      <span>{item.totalBytes ? filesize(item.totalBytes) : "-"}</span>
      <span>{item.createdTime ? formatMillisecond(item.createdTime) : "-"}</span>
    </div>
    <div className="flex justify-end">
      <DownloadActions data={item} />
    </div>
  </div>
);

const DownloadList = () => {
  const isMobileLayout = useIsMobileLayout();
  const downloadPath = useSettings(s => s.downloadPath);
  const [downloadList, setDownloadList] = useState<MediaDownloadTask[]>([]);
  const [fileType, setFileType] = useState<string>("all");

  useEffect(() => {
    const initList = async () => {
      const list = await platform.getMediaDownloadTaskList();
      if (list.length) {
        setDownloadList(list);
      }
    };

    initList();

    const removeListener = platform.syncMediaDownloadTaskList(payload => {
      if (payload?.type === "full") {
        setDownloadList(payload.data as MediaDownloadTask[]);
      } else if (payload?.type === "update") {
        setDownloadList(prev => {
          const updateTasks = payload.data;
          return prev.map(item => {
            const updateTask = updateTasks.find(t => t.id === item.id);
            return updateTask ? { ...item, ...updateTask } : item;
          });
        });
      }
    });

    return () => {
      removeListener();
    };
  }, []);

  const clearDownloadList = async () => {
    await platform.clearMediaDownloadTaskList();
  };

  const openDownloadDir = async () => {
    await platform.openDirectory(downloadPath);
  };

  const getFileQuality = (item: MediaDownloadTask) => {
    if (item.outputFileType === "video") {
      return item.videoResolution
        ? `${item.videoResolution}${item.videoFrameRate ? `@${item.videoFrameRate}` : ""}`
        : "";
    }

    if (item.audioCodecs === "flac") {
      return "flac";
    }

    if (item.audioCodecs?.includes("ec-3")) {
      return "杜比音频";
    }

    if (item.audioBandwidth) {
      return `${Math.round(item.audioBandwidth / 1000)} kbps`;
    }

    return "";
  };

  return (
    <ScrollContainer enableBackToTop className="h-full w-full px-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <h1 className="flex items-center space-x-1">下载记录</h1>
        <div className="flex items-center space-x-1">
          <Button
            variant="flat"
            onPress={openDownloadDir}
            startContent={<RiFolderLine size={18} />}
            isIconOnly={isMobileLayout}
            aria-label="打开下载目录"
            title={isMobileLayout ? downloadPath : undefined}
          >
            {!isMobileLayout && downloadPath}
          </Button>
        </div>
      </div>
      <Card radius="md" shadow="sm">
        <CardBody className={isMobileLayout ? "p-2" : undefined}>
          {isMobileLayout && (
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <RadioGroup
                orientation="horizontal"
                value={fileType}
                onValueChange={setFileType}
                classNames={{ wrapper: "gap-3" }}
              >
                <Radio value="all">全部</Radio>
                <Radio value="audio">音频</Radio>
                <Radio value="video">视频</Radio>
              </RadioGroup>
              {Boolean(downloadList.length) && (
                <PlatformTooltip content="清空记录" closeDelay={0}>
                  <Button size="sm" isIconOnly onPress={clearDownloadList} aria-label="清空记录">
                    <RiDeleteBinLine size={18} />
                  </Button>
                </PlatformTooltip>
              )}
            </div>
          )}
          <div className={isMobileLayout ? "" : "w-full overflow-x-auto"}>
            <Table
              className={isMobileLayout ? "hidden" : undefined}
              fullWidth
              radius="md"
              aria-label="下载列表"
              removeWrapper
              topContent={
                <div className="flex justify-between">
                  <RadioGroup
                    orientation="horizontal"
                    value={fileType}
                    onValueChange={setFileType}
                    classNames={{
                      wrapper: "gap-4",
                    }}
                  >
                    <Radio value="all">全部</Radio>
                    <Radio value="audio">音频</Radio>
                    <Radio value="video">视频</Radio>
                  </RadioGroup>
                  {Boolean(downloadList.length) && (
                    <PlatformTooltip content="清空记录" closeDelay={0}>
                      <Button size="sm" isIconOnly onPress={clearDownloadList} aria-label="清空记录">
                        <RiDeleteBinLine size={18} />
                      </Button>
                    </PlatformTooltip>
                  )}
                </div>
              }
              classNames={{
                th: "first:rounded-s-medium last:rounded-e-medium",
              }}
            >
              <TableHeader className="rounded-medium">
                <TableColumn width={350}>文件</TableColumn>
                <TableColumn align="center">状态</TableColumn>
                <TableColumn width={120} align="center">
                  大小
                </TableColumn>
                <TableColumn width={120} align="center">
                  下载时间
                </TableColumn>
                <TableColumn width={120} align="center">
                  操作
                </TableColumn>
              </TableHeader>
              <TableBody
                items={downloadList.filter(item => fileType === "all" || item.outputFileType === fileType)}
                emptyContent={<Empty />}
              >
                {item => {
                  const quality = getFileQuality(item);

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-[280px] truncate">
                        <div className="flex items-center space-x-2">
                          <Image radius="md" src={item.cover} width={48} height={48} className="mr-2 object-cover" />
                          <div className="flex min-w-0 flex-1 flex-col items-start space-y-1 overflow-hidden">
                            <div
                              className="group flex max-w-full min-w-0 cursor-pointer items-center space-x-1 hover:underline"
                              onClick={() =>
                                openBiliVideoLink({
                                  type: item.sid ? "audio" : "mv",
                                  bvid: item.bvid,
                                  sid: item.sid,
                                })
                              }
                            >
                              <span className="min-w-0 flex-auto truncate">{item.title}</span>
                              <RiExternalLinkLine className="w-0 flex-none group-hover:w-[16px]" />
                            </div>
                            {Boolean(quality) && (
                              <Chip size="sm" radius="sm" variant="flat">
                                {quality}
                              </Chip>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DownloadProgress data={item} />
                      </TableCell>
                      <TableCell>{item.totalBytes ? filesize(item.totalBytes) : "-"}</TableCell>
                      <TableCell>{item.createdTime ? formatMillisecond(item.createdTime) : "-"}</TableCell>
                      <TableCell>
                        <DownloadActions data={item} />
                      </TableCell>
                    </TableRow>
                  );
                }}
              </TableBody>
            </Table>
          </div>
          {isMobileLayout && (
            <div className="space-y-2">
              {downloadList.filter(item => fileType === "all" || item.outputFileType === fileType).length ? (
                downloadList
                  .filter(item => fileType === "all" || item.outputFileType === fileType)
                  .map(item => <MobileDownloadItem key={item.id} item={item} quality={getFileQuality(item)} />)
              ) : (
                <Empty className="min-h-40" />
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </ScrollContainer>
  );
};

export default DownloadList;
