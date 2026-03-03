import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea,
  addToast,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { isPrivateFav } from "@/common/utils/fav";
import ImageUpload from "@/components/image-upload";
import { postFavFolderAdd } from "@/service/fav-folder-add";
import { postFavFolderEdit } from "@/service/fav-folder-edit";
import { getFavFolderInfo, type FavFolderInfoData } from "@/service/fav-folder-info";
import { useFavoritesStore } from "@/store/favorite";

import ScrollContainer from "../scroll-container";

// 表单校验规则：title 必填（去除首尾空格），intro 可选
const schema = z.object({
  title: z.string().trim().min(1, "名称为必填项"),
  intro: z.string().optional(),
  cover: z.string().optional(),
  isPublic: z.boolean().default(true),
  syncToBili: z.boolean().default(false),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  /** 收藏夹id */
  mid?: number;
  /** 是否为本地收藏夹 */
  isLocal?: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSuccess?: (newData: FavFolderInfoData) => void;
}

const FavoritesEditModal = ({ mid, isLocal, isOpen, onOpenChange, onSuccess }: Props) => {
  const addCreatedFavorite = useFavoritesStore(state => state.addCreatedFavorite);
  const modifyCreatedFavorite = useFavoritesStore(state => state.modifyCreatedFavorite);
  const [isFetching, setIsFetching] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    watch,
    formState: { touchedFields, isSubmitting, isSubmitted, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { title: "", intro: "", isPublic: true, cover: "", syncToBili: false },
    mode: "onChange",
  });

  const syncToBili = watch("syncToBili");

  // 当传入 mid 且弹窗打开时，获取收藏夹数据并填充表单
  useEffect(() => {
    if (!isOpen) return;
    if (mid) {
      if (isLocal) {
        // 本地收藏夹：从 store 加载数据
        const item = useFavoritesStore.getState().createdFavorites.find(f => f.id === mid);
        if (item) {
          setValue("title", item.title ?? "");
          setValue("intro", item.intro ?? "");
          setValue("cover", item.cover ?? "");
          setValue("isPublic", true);
        }
      } else {
        let canceled = false;
        setIsFetching(true);
        (async () => {
          try {
            const res = await getFavFolderInfo({ media_id: mid });
            if (!canceled) {
              if (res?.code === 0 && res.data) {
                setValue("title", res.data.title ?? "");
                setValue("intro", res.data.intro ?? "");
                setValue("isPublic", !isPrivateFav(res.data.attr));
                setValue("cover", res.data.cover ?? "");
              } else {
                addToast({ color: "danger", title: "加载失败", description: res?.message || "请稍后再试" });
              }
            }
          } catch (error: any) {
            if (!canceled) {
              addToast({ color: "danger", title: "网络错误", description: error?.message || "请检查网络后重试" });
            }
          } finally {
            if (!canceled) setIsFetching(false);
          }
        })();
        return () => {
          canceled = true;
        };
      }
    } else {
      // 新建模式下清空表单
      reset({ title: "", intro: "", isPublic: true, cover: "", syncToBili: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mid, isLocal, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (mid) {
        if (isLocal) {
          // 本地收藏夹编辑：只更新 store
          modifyCreatedFavorite({
            id: mid,
            title: values.title.trim(),
            intro: values.intro?.trim(),
            cover: values.cover,
          });
          reset();
          onOpenChange(false);
        } else {
          const res = await postFavFolderEdit({
            media_id: mid,
            title: values.title.trim(),
            intro: values.intro?.trim(),
            privacy: values.isPublic ? 0 : 1,
            cover: values.cover,
          });

          if (res?.code === 0 && res.data?.id) {
            modifyCreatedFavorite({
              id: res.data.id,
              title: res.data.title,
              cover: res.data.cover,
              type: res.data.type,
              mid: res.data.mid,
            });
            reset();
            onOpenChange(false);
            onSuccess?.({
              ...res.data,
              // 接口数据更新存在延迟，这里使用上传的最新的 cover
              cover: values.cover || "",
            });
          } else {
            addToast({
              color: "danger",
              title: "修改失败",
              description: res?.message || "请稍后再试",
            });
          }
        }
      } else {
        if (!values.syncToBili) {
          // 本地创建：不调用B站接口
          const localId = -Date.now();
          addCreatedFavorite({
            id: localId,
            title: values.title.trim(),
            intro: values.intro?.trim(),
            cover: values.cover,
            type: 11,
            isLocal: true,
          });
          addToast({ color: "success", title: "创建成功" });
          reset();
          onOpenChange(false);
        } else {
          const res = await postFavFolderAdd({
            title: values.title.trim(),
            intro: values.intro?.trim(),
            privacy: values.isPublic ? 0 : 1,
            cover: values.cover,
          });
          if (res?.code === 0 && res.data?.id) {
            addCreatedFavorite({
              id: res.data.id,
              title: res.data.title,
              cover: res.data.cover,
              type: res.data.type,
              mid: res.data.mid,
            });
            addToast({ color: "success", title: "创建成功" });
            reset();
            onOpenChange(false);
            onSuccess?.({
              ...res.data,
              cover: values.cover || "",
            });
          } else {
            addToast({
              color: "danger",
              title: "创建失败",
              description: res?.message || "请稍后再试",
            });
          }
        }
      }
    } catch (error: any) {
      addToast({
        color: "danger",
        title: "网络错误",
        description: error?.message || "请检查网络后重试",
      });
    }
  };

  return (
    <Modal
      radius="md"
      size="md"
      scrollBehavior="inside"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!isSubmitting}
      disableAnimation
    >
      <ModalContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex h-full min-h-0 flex-1 flex-col">
          <ModalHeader className="py-3">{mid ? "修改收藏夹" : "新建收藏夹"}</ModalHeader>
          <ModalBody className="min-h-0 p-0">
            <ScrollContainer className="px-4">
              <div className="flex flex-col space-y-4">
                <Controller
                  name="cover"
                  control={control}
                  render={({ field }) => (
                    <ImageUpload
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isFetching || isSubmitting}
                      width={240}
                      height={150}
                    />
                  )}
                />

                <Controller
                  name="title"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Input
                      label="名称"
                      labelPlacement="outside"
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="请输入收藏夹名称"
                      isRequired
                      isDisabled={isFetching || isSubmitting}
                      isInvalid={(touchedFields.title || isSubmitted) && !!fieldState.error}
                      errorMessage={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  name="intro"
                  control={control}
                  render={({ field }) => (
                    <Textarea
                      label="简介"
                      labelPlacement="outside"
                      placeholder="可选，简单介绍此收藏夹"
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      minRows={4}
                      isDisabled={isFetching || isSubmitting}
                    />
                  )}
                />

                {!mid && (
                  <Controller
                    name="syncToBili"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        isSelected={Boolean(field.value)}
                        onValueChange={field.onChange}
                        isDisabled={isFetching || isSubmitting}
                      >
                        同步到B站
                      </Switch>
                    )}
                  />
                )}

                {(mid || syncToBili) && (
                  <Controller
                    name="isPublic"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        isSelected={Boolean(field.value)}
                        onValueChange={field.onChange}
                        isDisabled={isFetching || isSubmitting}
                      >
                        {field.value ? "公开" : "私密"}
                      </Switch>
                    )}
                  />
                )}
              </div>
            </ScrollContainer>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                reset();
                onOpenChange(false);
              }}
              isDisabled={isSubmitting || isFetching}
            >
              取消
            </Button>
            <Button type="submit" color="primary" isLoading={isSubmitting} isDisabled={!isValid || isFetching}>
              提交
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default FavoritesEditModal;
