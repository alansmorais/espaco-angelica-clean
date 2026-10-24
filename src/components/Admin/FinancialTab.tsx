import React, { useState } from 'react';
import { Service, ServiceCategory, Appointment } from '../../types';
import { uploadServicePhoto, listDrivePhotos, DrivePhoto } from '../../services/emailNotificationService';

interface FinancialTabProps {
  readOnlyPreview?: boolean;
  services?: Service[];
  onUpdateService?: (updated: Service) => Promise<void> | void;
  onAddService?: (newService: Service) => Promise<void> | void;
  onDeleteService?: (id: string) => Promise<void> | void;
  appointments?: Appointment[];
  adminSessionToken?: string;
}

const compressImageFile = (file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.85): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            quality
          );
        } else {
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

export const FinancialTab: React.FC<FinancialTabProps> = ({
  readOnlyPreview = false,
  services: propServices,
  onUpdateService,
  onAddService,
  onDeleteService,
  appointments = [],
  adminSessionToken
}) => {
  const [internalServices, setInternalServices] = useState<Service[]>([]);
  const services = propServices || internalServices;

  // Real KPI calculations from genuine appointments
  const confirmedApts = appointments.filter(
    a => a.status === 'confirmado' || a.depositStatus === 'liquidado'
  );
  const totalRealRevenue = confirmedApts.reduce((acc, a) => acc + (a.depositAmount || 0), 0);
  const avgTicket = confirmedApts.length > 0 ? Math.round(totalRealRevenue / confirmedApts.length) : 0;
  const activeServicesCount = services.filter(s => s.active !== false).length;

  // Search & Filter
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modal State for Add / Edit
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  // Form Fields
  const [formTitle, setFormTitle] = useState<string>('');
  const [formCategory, setFormCategory] = useState<ServiceCategory>('alongamento');
  const [formPrice, setFormPrice] = useState<number>(200);
  const [formDurationMinutes, setFormDurationMinutes] = useState<number>(120);
  const [formBadge, setFormBadge] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [formImageUrl, setFormImageUrl] = useState<string>('');
  const [formSpecs, setFormSpecs] = useState<string>('');
  const [formActive, setFormActive] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Async action states
  const [isSavingService, setIsSavingService] = useState<boolean>(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [drivePhotos, setDrivePhotos] = useState<DrivePhoto[]>([]);
  const [isLoadingDrivePhotos, setIsLoadingDrivePhotos] = useState(false);
  const [drivePhotoError, setDrivePhotoError] = useState<string | null>(null);

  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Deletion modal state
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [referencedCount, setReferencedCount] = useState<number>(0);

  // Feedback notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4500);
  };

  // Format minutes into clean human string (e.g. 150 -> "2h 30min", 90 -> "1h 30min", 45 -> "45min")
  const formatMinutes = (mins: number): string => {
    if (mins < 60) return `${mins}min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h 00min`;
  };

  // Parse duration text to minutes
  const parseDurationToMinutes = (dur: string): number => {
    const hoursMatch = dur.match(/(\d+)\s*h/i);
    const minsMatch = dur.match(/(\d+)\s*m/i);
    let total = 0;
    if (hoursMatch) total += parseInt(hoursMatch[1], 10) * 60;
    if (minsMatch) total += parseInt(minsMatch[1], 10);
    return total > 0 ? total : 90;
  };

  const handleOpenAddModal = () => {
    setEditingService(null);
    setFormTitle('');
    setFormCategory('alongamento');
    setFormPrice(150);
    setFormDurationMinutes(105); // 1h 45min
    setFormBadge('');
    setFormDescription('');
    setFormNote('Inclui cutilagem combinada e hidratação');
    setFormImageUrl('');
    setFormSpecs('Acabamento anatômico, Cutilagem combinada');
    setFormActive(true);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (service: Service) => {
    setEditingService(service);
    setFormTitle(service.title);
    setFormCategory(service.category);
    setFormPrice(service.price);
    setFormDurationMinutes(parseDurationToMinutes(service.duration));
    setFormBadge(service.badge || '');
    setFormDescription(service.description);
    setFormNote(service.note);
    setFormImageUrl(service.imageUrl);
    setFormSpecs(service.specs ? service.specs.join(', ') : '');
    setFormActive(service.active !== false);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleToggleActive = async (service: Service) => {
    const newActive = service.active === false ? true : false;
    const updated: Service = {
      ...service,
      active: newActive
    };

    try {
      if (onUpdateService) {
        await onUpdateService(updated);
      } else {
        setInternalServices(prev => prev.map(s => s.id === updated.id ? updated : s));
      }

      showNotification(
        newActive
          ? `Procedimento "${service.title}" ativado e visível no autoagendamento.`
          : `Procedimento "${service.title}" desativado (ocultado do agendamento de clientes).`,
        newActive ? 'success' : 'info'
      );
    } catch (err: any) {
      showNotification(err.message || 'Falha ao atualizar status do procedimento no servidor.', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setFormError('A imagem deve ter no máximo 5MB.');
      return;
    }

    try {
      setIsUploadingPhoto(true);
      setFormError(null);

      // Client-side canvas compression to avoid memory / storage quota overflow
      const compressed = await compressImageFile(file);

      // A foto só pode ser usada no catálogo após receber uma URL permanente do Google Drive.
      const uploadRes = await uploadServicePhoto(compressed, adminSessionToken);
      if (uploadRes.success && uploadRes.url) {
        setFormImageUrl(uploadRes.url);
        showNotification('Foto enviada e vinculada com sucesso ao Google Drive.', 'success');
      } else {
        setFormImageUrl('');
        setFormError(uploadRes.error || 'O Google Drive não confirmou o upload. Tente novamente antes de salvar o serviço.');
      }
    } catch (err: any) {
      setFormError(`Erro ao processar imagem: ${err.message || 'Falha no processamento'}`);
    } finally {
      setIsUploadingPhoto(false);
      // Reset input value so same file can be re-selected if desired
      e.target.value = '';
    }
  };

  const handleOpenDrivePicker = async () => {
    setIsDrivePickerOpen(true);
    setIsLoadingDrivePhotos(true);
    setDrivePhotoError(null);
    const result = await listDrivePhotos(adminSessionToken);
    if (result.success) setDrivePhotos(result.photos || []);
    else setDrivePhotoError(result.error || 'Não foi possível carregar as fotos.');
    setIsLoadingDrivePhotos(false);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Form Validations
    if (!formTitle.trim()) {
      setFormError('O título/nome do procedimento é obrigatório.');
      return;
    }

    if (!formDescription.trim()) {
      setFormError('A descrição do procedimento é obrigatória para informar a cliente.');
      return;
    }

    const priceNum = Number(formPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError('O valor cobrado em Reais (BRL) deve ser maior que zero.');
      return;
    }

    const mins = Number(formDurationMinutes);
    if (isNaN(mins) || mins <= 0) {
      setFormError('A duração em minutos deve ser maior que zero.');
      return;
    }

    const durationFormatted = formatMinutes(mins);
    const priceFormatted = `R$ ${priceNum.toFixed(2).replace('.', ',')}`;
    const specsArray = formSpecs.split(',').map(s => s.trim()).filter(Boolean);

    try {
      setIsSavingService(true);

      if (editingService) {
        const updated: Service = {
          ...editingService,
          title: formTitle.trim(),
          category: formCategory,
          price: priceNum,
          priceFormatted,
          duration: durationFormatted,
          badge: formBadge.trim() || undefined,
          description: formDescription.trim(),
          note: formNote.trim(),
          imageUrl: formImageUrl.trim(),
          specs: specsArray,
          active: formActive
        };

        if (onUpdateService) {
          await onUpdateService(updated);
        } else {
          setInternalServices(prev => prev.map(s => (s.id === updated.id ? updated : s)));
        }
        showNotification(`Procedimento "${updated.title}" atualizado com sucesso!`);
      } else {
        const newService: Service = {
          id: `serv-${Date.now()}`,
          title: formTitle.trim(),
          category: formCategory,
          price: priceNum,
          priceFormatted,
          duration: durationFormatted,
          badge: formBadge.trim() || undefined,
          description: formDescription.trim(),
          note: formNote.trim(),
          imageUrl: formImageUrl.trim(),
          specs: specsArray,
          active: formActive
        };

        if (onAddService) {
          await onAddService(newService);
        } else {
          setInternalServices(prev => [newService, ...prev]);
        }
        showNotification(`Novo serviço "${newService.title}" cadastrado com sucesso!`);
      }

      setIsEditModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Falha ao salvar o procedimento no servidor.');
    } finally {
      setIsSavingService(false);
    }
  };

  // Safe Deletion Handler
  const initiateDelete = (service: Service) => {
    // Check if referenced in historical appointments
    const matchedAppointments = appointments.filter(
      a =>
        a.serviceTitle.toLowerCase().trim() === service.title.toLowerCase().trim() ||
        a.serviceTitle.toLowerCase().includes(service.title.toLowerCase())
    );

    setReferencedCount(matchedAppointments.length);
    setServiceToDelete(service);
  };

  const confirmSafeDeactivate = async () => {
    if (!serviceToDelete) return;
    const updated: Service = {
      ...serviceToDelete,
      active: false
    };

    try {
      setIsDeleting(true);
      if (onUpdateService) {
        await onUpdateService(updated);
      } else {
        setInternalServices(prev => prev.map(s => s.id === updated.id ? updated : s));
      }

      showNotification(
        `Procedimento "${serviceToDelete.title}" desativado. Registros históricos e faturamento foram preservados.`,
        'info'
      );
      setServiceToDelete(null);
    } catch (err: any) {
      showNotification(err.message || 'Falha ao desativar procedimento.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!serviceToDelete) return;
    try {
      setIsDeleting(true);
      if (onDeleteService) {
        await onDeleteService(serviceToDelete.id);
      } else {
        setInternalServices(prev => prev.filter(s => s.id !== serviceToDelete.id));
      }

      showNotification(`Procedimento "${serviceToDelete.title}" excluído do catálogo.`);
      setServiceToDelete(null);
    } catch (err: any) {
      showNotification(err.message || 'Falha ao excluir procedimento no servidor.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = services.filter(s => {
    const matchesCategory = filterCategory === 'all' || s.category === filterCategory;
    const matchesSearch =
      s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && s.active !== false) ||
      (filterStatus === 'inactive' && s.active === false);
    return matchesCategory && matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6 text-[#49382E]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[#D4AF37] mb-1">
            <span className="material-symbols-outlined text-[18px]">diamond</span>
            <span className="font-jakarta text-[11px] uppercase tracking-widest font-bold">
              Gestão de Procedimentos &amp; Precificação Real
            </span>
          </div>
          <h1 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold tracking-tight">
            Serviços, Fotos &amp; Tabela de Preços
          </h1>
          <p className="font-jakarta text-xs sm:text-sm text-[#786C63]">
            Edite valores em Reais, duração técnica, fotos em alta resolução e ative ou desative procedimentos no agendamento público.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>+ Novo Procedimento</span>
          </button>
        </div>
      </div>

      {/* Global Notification Banner */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl font-jakarta text-xs font-bold flex items-center justify-between shadow-xs transition-all ${
            notification.type === 'error'
              ? 'bg-red-100 text-red-800 border border-red-300'
              : notification.type === 'info'
              ? 'bg-[#FBF2D5] text-[#3C2F00] border border-[#E8D9B5]'
              : 'bg-[#D4AF37] text-[#3C2F00]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">
              {notification.type === 'error' ? 'error' : notification.type === 'info' ? 'info' : 'check_circle'}
            </span>
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Real Financial & Catalog KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
          <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
            Receita Real em Caixa
          </span>
          <div className="my-2">
            <span className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold">
              R$ {totalRealRevenue.toFixed(2).replace('.', ',')}
            </span>
          </div>
          <span className="font-jakarta text-[11px] text-[#786C63]">
            {confirmedApts.length} atendimento(s) com sinal quitado
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
          <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
            Ticket Médio por Sessão
          </span>
          <div className="my-2">
            <span className="font-syne text-2xl sm:text-3xl text-[#D4AF37] font-bold">
              R$ {avgTicket.toFixed(2).replace('.', ',')}
            </span>
          </div>
          <span className="font-jakarta text-[11px] text-[#786C63]">
            Calculado sobre sessões confirmadas
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
          <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
            Procedimentos Ativos
          </span>
          <div className="my-2">
            <span className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold">
              {activeServicesCount}
            </span>
            <span className="font-jakarta text-xs text-[#786C63] ml-1.5">
              de {services.length} cadastrados
            </span>
          </div>
          <span className="font-jakarta text-[11px] text-[#786C63]">
            Disponíveis para autoagendamento
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
          <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
            Sinais Pix Retidos
          </span>
          <div className="my-2">
            <span className="font-syne text-2xl sm:text-3xl text-[#D4AF37] font-bold">
              R$ {totalRealRevenue.toFixed(2).replace('.', ',')}
            </span>
          </div>
          <span className="font-jakarta text-[11px] text-[#786C63]">
            Segurança de comparecimento no ateliê
          </span>
        </div>
      </div>

      {/* Services Management Box */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-6">
        {/* Search, Status & Category Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#E8D9B5]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px]">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#786C63] text-[18px]">
                search
              </span>
              <input
                type="text"
                placeholder="Buscar por nome ou técnica..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-full bg-[#FDFBF9] text-xs text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
              />
            </div>

            {/* Category Filter */}
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 rounded-full bg-[#FDFBF9] text-xs text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
            >
              <option value="all">Todas Categorias</option>
              <option value="alongamento">Alongamento</option>
              <option value="blindagem">Blindagem &amp; Gel</option>
              <option value="nailart">Nail Art Autoral</option>
              <option value="spa">Spa &amp; Cuidados</option>
              <option value="depilacao">Depilação</option>
            </select>

            {/* Availability Status Filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as any)}
              className="px-3 py-1.5 rounded-full bg-[#FDFBF9] text-xs text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
            >
              <option value="all">Todos os Status</option>
              <option value="active">Somente Ativos</option>
              <option value="inactive">Somente Inativos</option>
            </select>
          </div>

          <span className="font-jakarta text-xs text-[#786C63]">
            Exibindo <strong>{filtered.length}</strong> procedimento(s)
          </span>
        </div>

        {/* Empty state if no services match filter */}
        {filtered.length === 0 && (
          <div className="p-10 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] text-center">
            <span className="material-symbols-outlined text-[#D4AF37] text-[36px] mb-2 block">
              manage_search
            </span>
            <h3 className="font-syne text-base text-[#49382E] font-bold">
              Nenhum procedimento encontrado
            </h3>
            <p className="font-jakarta text-xs text-[#786C63] mt-1">
              Tente redefinir os filtros de busca ou cadastre um novo procedimento no botão acima.
            </p>
          </div>
        )}

        {/* Services List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(s => {
            const isActive = s.active !== false;

            return (
              <div
                key={s.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 shadow-xs group ${
                  isActive
                    ? 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37]'
                    : 'bg-[#F7EFEA]/60 border-[#E8D9B5] opacity-80'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* Photo Thumbnail */}
                  <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-[#F7EFEA] shrink-0 border border-[#E8D9B5] shadow-xs">
                    <img
                      src={s.imageUrl}
                      alt={s.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(s)}
                      title="Editar Procedimento"
                      className="absolute inset-0 bg-[#49382E]/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[20px] text-[#D4AF37]">photo_camera</span>
                    </button>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-syne text-sm sm:text-base text-[#49382E] font-bold truncate">
                        {s.title}
                      </span>
                      {/* Active/Inactive Badge */}
                      <span
                        className={`px-2 py-0.5 rounded-full font-jakarta text-[10px] font-bold ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {isActive ? 'Ativo' : 'Inativo (Oculto)'}
                      </span>
                      {s.badge && (
                        <span className="px-2 py-0.5 rounded-full bg-[#FBF2D5] text-[#3C2F00] font-jakarta text-[10px] font-bold border border-[#E8D9B5]">
                          {s.badge}
                        </span>
                      )}
                    </div>

                    <p className="font-jakarta text-[11px] text-[#786C63] line-clamp-2 leading-relaxed">
                      {s.description}
                    </p>

                    <div className="flex items-center gap-3 mt-2 text-[11px] font-jakarta text-[#49382E]">
                      <span className="flex items-center gap-1 text-[#D4AF37] font-semibold">
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        {s.duration}
                      </span>
                      <span className="text-[#E8D9B5]">•</span>
                      <span className="uppercase tracking-wider text-[10px] text-[#786C63] font-medium">
                        {s.category}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom bar with price & action buttons */}
                <div className="pt-3 border-t border-[#E8D9B5] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase text-[#786C63] block font-jakarta">Valor Cobrado</span>
                    <span className="font-syne text-lg text-[#D4AF37] font-bold">{s.priceFormatted}</span>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* Fast Availability Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleActive(s)}
                      title={isActive ? 'Desativar este serviço do agendamento' : 'Ativar este serviço no agendamento'}
                      className={`px-2.5 py-1.5 rounded-full font-jakarta text-[11px] font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {isActive ? 'visibility' : 'visibility_off'}
                      </span>
                      <span>{isActive ? 'Ativo' : 'Inativo'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(s)}
                      className="px-3 py-1.5 rounded-full bg-[#FFFFFF] hover:bg-[#FDFBF9] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] hover:border-[#D4AF37] font-jakarta text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                    >
                      <span className="material-symbols-outlined text-[15px] text-[#D4AF37]">edit</span>
                      <span>Editar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => initiateDelete(s)}
                      className="w-8 h-8 rounded-full bg-[#FFFFFF] hover:bg-red-50 text-[#786C63] hover:text-red-600 border border-[#E8D9B5] flex items-center justify-center transition-colors cursor-pointer shadow-xs"
                      title="Excluir ou Desativar Procedimento"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit / Add Service Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-2xl w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="flex items-center gap-2.5 mb-6">
              <span className="material-symbols-outlined text-[#D4AF37] text-[28px]">
                {editingService ? 'edit_note' : 'add_circle'}
              </span>
              <div>
                <h3 className="font-syne text-xl text-[#49382E] font-bold">
                  {editingService ? `Editar Procedimento: ${editingService.title}` : 'Cadastrar Novo Procedimento'}
                </h3>
                <p className="font-jakarta text-xs text-[#786C63]">
                  Configure os dados reais do serviço exibido no catálogo público e no agendamento.
                </p>
              </div>
            </div>

            {/* Modal Error Banner */}
            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 font-jakarta text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-red-600">error</span>
                <span>{formError}</span>
              </div>
            )}

            {isDrivePickerOpen && (
              <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Escolher foto do Google Drive">
                <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white border border-[#E8D9B5] shadow-2xl flex flex-col">
                  <div className="p-4 border-b border-[#E8D9B5] flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-syne text-lg font-bold text-[#49382E]">Escolher do Google Drive</h3>
                      <p className="font-jakarta text-xs text-[#786C63]">Fotos da pasta oficial do ateliê</p>
                    </div>
                    <button type="button" onClick={() => setIsDrivePickerOpen(false)} className="rounded-lg p-2 hover:bg-[#F7EFEA]" aria-label="Fechar seletor">✕</button>
                  </div>
                  <div className="p-4 overflow-y-auto">
                    {isLoadingDrivePhotos && <p className="text-sm text-[#786C63]">A carregar fotografias...</p>}
                    {drivePhotoError && <p className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{drivePhotoError}</p>}
                    {!isLoadingDrivePhotos && !drivePhotoError && drivePhotos.length === 0 && <p className="text-sm text-[#786C63]">Não foram encontradas fotografias na pasta.</p>}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {drivePhotos.map(photo => (
                        <button key={photo.id} type="button" onClick={() => { setFormImageUrl(photo.thumbnailUrl || photo.url); setIsDrivePickerOpen(false); showNotification('Foto do Google Drive selecionada. Guarde o procedimento para confirmar a alteração.', 'success'); }} className="text-left rounded-xl overflow-hidden border border-[#E8D9B5] hover:border-[#D4AF37] hover:ring-2 hover:ring-[#D4AF37]/40 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                          <img src={photo.thumbnailUrl || photo.url} alt={photo.name} loading="lazy" className="w-full aspect-square object-cover bg-[#F7EFEA]" />
                          <span className="block p-2 text-[11px] text-[#49382E] truncate" title={photo.name}>{photo.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <form onSubmit={handleSaveService} className="space-y-5 font-jakarta text-xs">
              {/* Image Selection Section */}
              <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-3">
                <span className="block text-[#49382E] font-semibold">Fotografia do Procedimento</span>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#F7EFEA] shrink-0 border border-[#E8D9B5] relative">
                    {formImageUrl ? <img src={formImageUrl} alt="Pré-visualização da foto do Drive" className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-[#A89A8C] gap-2"><span className="material-symbols-outlined text-3xl">add_photo_alternate</span><span className="text-[10px]">Selecione uma foto do Drive</span></div>}
                    {isUploadingPhoto && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-[20px] animate-spin">progress_activity</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="url"
                      value={formImageUrl}
                      onChange={e => setFormImageUrl(e.target.value)}
                      placeholder="Cole o link da imagem (URL HTTPS)"
                      className="w-full px-3 py-1.5 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
                    />
                    <div className="flex items-center gap-2">
                      <label className={`px-3 py-1.5 rounded-lg bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold inline-flex items-center gap-1.5 border border-[#E8D9B5] transition-colors ${isUploadingPhoto ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <span className={`material-symbols-outlined text-[15px] text-[#D4AF37] ${isUploadingPhoto ? 'animate-spin' : ''}`}>
                          {isUploadingPhoto ? 'progress_activity' : 'upload'}
                        </span>
                        <span>{isUploadingPhoto ? 'Enviando foto...' : 'Carregar do dispositivo'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          disabled={isUploadingPhoto}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleOpenDrivePicker}
                        disabled={isUploadingPhoto}
                        className="px-3 py-1.5 rounded-lg bg-[#FBF2D5] hover:bg-[#F3E4A8] text-[#49382E] font-semibold inline-flex items-center gap-1.5 border border-[#E8D9B5] transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[15px] text-[#D4AF37]">add_to_drive</span>
                        Escolher do Google Drive
                      </button>
                      {formImageUrl && (
                        <button
                          type="button"
                          onClick={() => setFormImageUrl('')}
                          className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold border border-red-200 transition-colors cursor-pointer"
                        >
                          Remover foto
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-[#786C63]">As imagens do catálogo devem ser escolhidas na pasta oficial do Google Drive. Nenhuma foto de demonstração será usada como substituta.</p>
              </div>

              {/* Service Info Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Nome do Procedimento *
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                    placeholder="Ex: Alongamento em Fibra Slim"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Categoria
                  </label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value as ServiceCategory)}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                  >
                    <option value="alongamento">Alongamento</option>
                    <option value="blindagem">Blindagem &amp; Gel</option>
                    <option value="nailart">Nail Art Autoral</option>
                    <option value="spa">Spa &amp; Cuidados</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Preço em Reais (BRL) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-[#D4AF37] font-bold">R$</span>
                    <input
                      type="number"
                      required
                      min={1}
                      step={1}
                      value={formPrice}
                      onChange={e => setFormPrice(Number(e.target.value))}
                      className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Duração em Minutos * ({formatMinutes(formDurationMinutes)})
                  </label>
                  <input
                    type="number"
                    required
                    min={15}
                    step={15}
                    value={formDurationMinutes}
                    onChange={e => setFormDurationMinutes(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              {/* Status and Badge */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Selo de Destaque (Opcional)
                  </label>
                  <input
                    type="text"
                    value={formBadge}
                    onChange={e => setFormBadge(e.target.value)}
                    placeholder="Ex: Mais Pedido, Exclusivo, Novidade"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-semibold mb-1">
                    Status de Disponibilidade
                  </label>
                  <div
                    onClick={() => setFormActive(prev => !prev)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer select-none transition-colors ${
                      formActive
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-amber-50 border-amber-300 text-amber-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">
                        {formActive ? 'check_circle' : 'visibility_off'}
                      </span>
                      <span className="font-bold">
                        {formActive ? 'Ativo (Disponível no Site)' : 'Inativo (Oculto)'}
                      </span>
                    </div>
                    <span className="text-[10px] underline">Alternar</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[#49382E] font-semibold mb-1">
                  Nota Adicional de Rodapé
                </label>
                <input
                  type="text"
                  value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  placeholder="Ex: Garantia estrutural de 7 dias"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] font-semibold mb-1">
                  Especificações Técnicas Rápidas (separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={formSpecs}
                  onChange={e => setFormSpecs(e.target.value)}
                  placeholder="Ex: Curvatura C Slim, Cutilagem combinada russa"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] font-semibold mb-1">
                  Descrição Completa do Procedimento *
                </label>
                <textarea
                  rows={3}
                  required
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Descreva a técnica, materiais nobres utilizados e benefícios para as unhas da cliente..."
                  className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div className="pt-4 border-t border-[#E8D9B5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSavingService}
                  className="px-5 py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingService || isUploadingPhoto}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all shadow-md cursor-pointer disabled:opacity-60"
                >
                  {isSavingService && (
                    <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  )}
                  <span>
                    {isSavingService
                      ? 'Salvando...'
                      : editingService
                      ? 'Salvar Alterações'
                      : 'Cadastrar Procedimento'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog / Safe Historical Deletion Protection Modal */}
      {serviceToDelete && (
        <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] p-6 sm:p-7 rounded-2xl max-w-md w-full border border-[#E8D9B5] shadow-2xl relative font-jakarta text-xs">
            {referencedCount > 0 ? (
              // Service is referenced by existing appointments -> Safe Archive Recommendation
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-amber-600">
                  <span className="material-symbols-outlined text-[28px]">shield</span>
                  <h3 className="font-syne text-lg text-[#49382E] font-bold">
                    Proteção de Registros Históricos
                  </h3>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-[#49382E] space-y-2 leading-relaxed">
                  <p>
                    O procedimento <strong className="text-[#49382E]">"{serviceToDelete.title}"</strong> está vinculado a <strong>{referencedCount} agendamento(s)</strong> no histórico do ateliê.
                  </p>
                  <p className="text-amber-800">
                    Para garantir a exatidão dos relatórios financeiros e o histórico de atendimentos das clientes, não é recomendada a exclusão permanente deste registro.
                  </p>
                  <p className="text-[#49382E] font-semibold">
                    Recomendamos <strong>Desativar o Procedimento</strong>. Ele será imediatamente ocultado do menu público e do autoagendamento, enquanto todo o histórico financeiro permanecerá íntegro.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2 border-t border-[#E8D9B5]">
                  <button
                    type="button"
                    onClick={() => setServiceToDelete(null)}
                    disabled={isDeleting}
                    className="w-full sm:w-auto px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold cursor-pointer transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmSafeDeactivate}
                    disabled={isDeleting}
                    className="flex items-center justify-center gap-1.5 w-full sm:w-auto px-5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md disabled:opacity-60"
                  >
                    {isDeleting && (
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    )}
                    <span>{isDeleting ? 'Processando...' : 'Desativar Procedimento (Recomendado)'}</span>
                  </button>
                </div>
              </div>
            ) : (
              // Service has NO references -> Permanent Deletion Allowed
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <span className="material-symbols-outlined text-[28px]">delete_forever</span>
                  <h3 className="font-syne text-lg text-[#49382E] font-bold">
                    Confirmar Exclusão de Procedimento
                  </h3>
                </div>

                <p className="text-[#786C63] leading-relaxed">
                  Tem certeza que deseja excluir o procedimento <strong className="text-[#49382E]">"{serviceToDelete.title}"</strong>?
                  Este procedimento não possui atendimentos vinculados no histórico e será removido definitivamente da tabela.
                </p>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8D9B5]">
                  <button
                    type="button"
                    onClick={() => setServiceToDelete(null)}
                    disabled={isDeleting}
                    className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold cursor-pointer transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmPermanentDelete}
                    disabled={isDeleting}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold transition-all cursor-pointer shadow-md disabled:opacity-60"
                  >
                    {isDeleting && (
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    )}
                    <span>{isDeleting ? 'Excluindo...' : 'Excluir Permanentemente'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
