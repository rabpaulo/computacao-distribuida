import { ProductModel } from '../models/product.model';

export async function seedProductsIfEmpty(): Promise<void> {
  try {
    const count = await ProductModel.countDocuments();
    if (count > 0) return;

    console.log('[products-service] Banco vazio. Inserindo produtos iniciais para demonstração...');

    const sampleProducts = [
      {
        name: 'Notebook Dell XPS 15 Ultra',
        description: 'Processador Intel Core i9 14th Gen, 32GB RAM DDR5, 1TB SSD NVMe, Tela OLED 4K Touch.',
        price: 11499.90,
        category: 'Informática',
        stock: 15,
        active: true,
        images: ['https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=600&auto=format&fit=crop&q=80'],
        attributes: { marca: 'Dell', processador: 'Intel i9', ram: '32GB' },
      },
      {
        name: 'Smartphone DistriPro Galaxy 5G',
        description: 'Câmera tripla de 108MP, tela Dynamic AMOLED 6.8 120Hz, 256GB de armazenamento e bateria 5000mAh.',
        price: 4299.00,
        category: 'Eletrônicos',
        stock: 30,
        active: true,
        images: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80'],
        attributes: { marca: 'DistriTech', tela: '6.8 polegadas', rede: '5G' },
      },
      {
        name: 'Headphone Noise Cancelling Sony WH-1000XM5',
        description: 'Cancelamento de ruído ativo líder de mercado, áudio Hi-Res sem fio e até 30 horas de autonomia.',
        price: 2199.90,
        category: 'Áudio',
        stock: 25,
        active: true,
        images: ['https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80'],
        attributes: { tipo: 'Over-ear', conexao: 'Bluetooth 5.2' },
      },
      {
        name: 'Teclado Mecânico Custom RGB Hot-Swap',
        description: 'Switches Gateron Yellow lubrificados de fábrica, iluminação RGB por tecla, keycaps PBT doubleshot.',
        price: 549.00,
        category: 'Periféricos',
        stock: 40,
        active: true,
        images: ['https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80'],
        attributes: { switch: 'Linear', layout: '75%' },
      },
      {
        name: 'Mouse Gamer Sem Fio Ultraleve 49g',
        description: 'Sensor óptico PixArt 3395 de 26.000 DPI, taxa de atualização de 4000Hz, switches ópticos.',
        price: 389.90,
        category: 'Periféricos',
        stock: 50,
        active: true,
        images: ['https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&auto=format&fit=crop&q=80'],
        attributes: { peso: '49g', dpi: '26000' },
      },
      {
        name: 'Monitor Gamer Curvo 34" WQHD 165Hz',
        description: 'Painel VA Ultrawide 3440x1440, curvatura 1000R, tempo de resposta 1ms MPRT e HDR400.',
        price: 2899.00,
        category: 'Informática',
        stock: 12,
        active: true,
        images: ['https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&auto=format&fit=crop&q=80'],
        attributes: { resolucao: '3440x1440', taxa: '165Hz' },
      },
    ];

    await ProductModel.insertMany(sampleProducts);
    console.log(`[products-service] ${sampleProducts.length} produtos iniciais inseridos com sucesso.`);
  } catch (error) {
    console.warn('[products-service] Não foi possível executar o seed inicial:', error);
  }
}
